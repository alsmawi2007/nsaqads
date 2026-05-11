import { Injectable } from '@nestjs/common';
import { InsightFeedback, InsightInteraction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RuleFeedbackBreakdownDto,
  RuleHealthEntryDto,
  RuleHealthHooksDto,
  RuleHealthResponseDto,
  RuleHealthSummaryDto,
} from './rule-performance.dto';
import {
  RATE_THRESHOLDS,
  RuleHealth,
  RuleHealthConfidence,
  RuleRecommendedAction,
  SAMPLE_THRESHOLDS,
  SCORE_WEIGHTS,
} from './rule-performance.types';

// Adaptive intelligence layer over insight_interactions. This service is
// strictly READ-ONLY: it observes feedback aggregates per rule, classifies
// the rule's health, and emits advisory hooks for *potential* future
// auto-tuning. Nothing in the codebase consumes the hooks today — they are
// surfaced to system admins so a human can decide whether to act.
//
// Design notes:
//   1. We classify per (orgId, ruleId) when scoped, or per ruleId across
//      orgs when the admin asks for the cross-org view. Each scope is
//      classified independently so a rule's NEEDS_TUNING status in one org
//      doesn't bleed into another.
//   2. LOW_SIGNAL is checked first — without a sufficient sample we make no
//      claim either way (rule may be perfectly fine, just under-evaluated).
//   3. NEEDS_TUNING beats UNSTABLE: a high WRONG rate is the loudest signal,
//      even if useful is also high.
//   4. ruleScore is a normalized 0..100 score that combines useful, inverse
//      wrong, inverse needs-context, and a saturating sample-size factor.
//      Useful as a single sortable column in the admin table.
@Injectable()
export class RulePerformanceService {
  constructor(private prisma: PrismaService) {}

  // Per-org rule health. Scope label is the orgId itself so the admin UI
  // can render multiple scopes side-by-side without ambiguity.
  async getForOrg(orgId: string): Promise<RuleHealthResponseDto> {
    const rows = await this.prisma.insightInteraction.findMany({ where: { orgId } });
    return this.classify(orgId, rows);
  }

  // Cross-org view aggregating every interaction by ruleId. Useful for
  // identifying rules that are weak everywhere, not just in one org.
  async getForAllOrgs(): Promise<RuleHealthResponseDto> {
    const rows = await this.prisma.insightInteraction.findMany({});
    return this.classify('ALL', rows);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private classify(scope: string, rows: InsightInteraction[]): RuleHealthResponseDto {
    const byRule = new Map<string, InsightInteraction[]>();
    let uncategorizedCount = 0;
    for (const row of rows) {
      const rid = row.relatedRuleId;
      if (rid === null) {
        uncategorizedCount++;
        continue;
      }
      const arr = byRule.get(rid) ?? [];
      arr.push(row);
      byRule.set(rid, arr);
    }

    const entries: RuleHealthEntryDto[] = [];
    for (const [ruleId, group] of byRule) {
      entries.push(this.classifyRule(scope, ruleId, group));
    }

    // Sort: NEEDS_TUNING first (loudest signal), then UNSTABLE, then HEALTHY,
    // then LOW_SIGNAL. Within a band, lower ruleScore first so the worst
    // performers float up.
    entries.sort((a, b) => {
      const ha = healthRank(a.health);
      const hb = healthRank(b.health);
      if (ha !== hb) return ha - hb;
      return a.ruleScore - b.ruleScore;
    });

    return {
      scope,
      summary: summarize(entries),
      rules: entries,
      uncategorizedCount,
      generatedAt: new Date().toISOString(),
    };
  }

  private classifyRule(scope: string, ruleId: string, rows: InsightInteraction[]): RuleHealthEntryDto {
    const breakdown = computeBreakdown(rows);
    const ruleScore = computeRuleScore(breakdown);
    const confidence = computeConfidence(breakdown.interactionCount);

    const { health, reasons } = classifyHealth(breakdown);
    const hooks = buildHooks(health, breakdown, ruleScore);

    return { ruleId, scope, health, confidence, ruleScore, reasons, breakdown, hooks };
  }
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function computeBreakdown(rows: InsightInteraction[]): RuleFeedbackBreakdownDto {
  const counts: Record<InsightFeedback, number> = {
    USEFUL: 0, NOT_USEFUL: 0, WRONG: 0, NEEDS_MORE_CONTEXT: 0,
  };
  let withFeedbackCount = 0;
  for (const row of rows) {
    if (row.feedback) {
      counts[row.feedback]++;
      withFeedbackCount++;
    }
  }
  const rateOver = (n: number, d: number): number => (d === 0 ? 0 : round4(n / d));
  return {
    interactionCount:      rows.length,
    withFeedbackCount,
    usefulCount:           counts.USEFUL,
    notUsefulCount:        counts.NOT_USEFUL,
    wrongCount:            counts.WRONG,
    needsMoreContextCount: counts.NEEDS_MORE_CONTEXT,
    usefulRate:            rateOver(counts.USEFUL, withFeedbackCount),
    notUsefulRate:         rateOver(counts.NOT_USEFUL, withFeedbackCount),
    wrongRate:             rateOver(counts.WRONG, withFeedbackCount),
    needsMoreContextRate:  rateOver(counts.NEEDS_MORE_CONTEXT, withFeedbackCount),
  };
}

export function computeRuleScore(b: RuleFeedbackBreakdownDto): number {
  // Without any feedback yet, rate-based factors are zero — the score
  // collapses to the sample-size factor only, which is also ~zero, so
  // freshly-introduced rules score near 0 (correct: they have no track
  // record).
  const sampleFactor = Math.min(1, b.interactionCount / SAMPLE_THRESHOLDS.HIGH_CONFIDENCE);
  const score =
    SCORE_WEIGHTS.USEFUL        * b.usefulRate +
    SCORE_WEIGHTS.NOT_WRONG     * (1 - b.wrongRate) +
    SCORE_WEIGHTS.NOT_NEEDS_CTX * (1 - b.needsMoreContextRate) +
    SCORE_WEIGHTS.SAMPLE        * sampleFactor;
  // When there is zero feedback, NOT_WRONG and NOT_NEEDS_CTX evaluate to 1.0
  // even though we have no evidence — neutralize that unearned credit.
  if (b.withFeedbackCount === 0) {
    return Math.round(SCORE_WEIGHTS.SAMPLE * sampleFactor * 100);
  }
  return Math.round(score * 100);
}

export function computeConfidence(interactionCount: number): RuleHealthConfidence {
  if (interactionCount >= SAMPLE_THRESHOLDS.HIGH_CONFIDENCE)   return RuleHealthConfidence.HIGH;
  if (interactionCount >= SAMPLE_THRESHOLDS.MEDIUM_CONFIDENCE) return RuleHealthConfidence.MEDIUM;
  return RuleHealthConfidence.LOW;
}

export function classifyHealth(b: RuleFeedbackBreakdownDto): { health: RuleHealth; reasons: string[] } {
  const reasons: string[] = [];

  // Step 1: insufficient sample dominates everything else.
  if (b.interactionCount < SAMPLE_THRESHOLDS.MIN_FOR_CLASSIFICATION) {
    reasons.push(
      `Only ${b.interactionCount} interaction(s) recorded — minimum ${SAMPLE_THRESHOLDS.MIN_FOR_CLASSIFICATION} needed for a verdict.`,
    );
    return { health: RuleHealth.LOW_SIGNAL, reasons };
  }
  // Without any *feedback* (status-only interactions), we still can't
  // judge correctness. Treat as LOW_SIGNAL.
  if (b.withFeedbackCount === 0) {
    reasons.push('No feedback verdicts captured — rule firing has been seen but never rated.');
    return { health: RuleHealth.LOW_SIGNAL, reasons };
  }

  // Step 2: high WRONG rate dominates everything else — even high useful is
  // not enough to outweigh users explicitly marking the rule wrong.
  if (b.wrongRate >= RATE_THRESHOLDS.TUNING_WRONG_MIN) {
    reasons.push(`wrongRate ${(b.wrongRate * 100).toFixed(1)}% ≥ ${(RATE_THRESHOLDS.TUNING_WRONG_MIN * 100).toFixed(0)}% threshold.`);
    return { health: RuleHealth.NEEDS_TUNING, reasons };
  }

  // Step 3: split verdict — both useful and wrong are non-trivial, meaning
  // the rule is right *some* of the time. Suggests context-dependence
  // (different orgs / phases need different thresholds), not a wrong rule.
  if (
    b.usefulRate >= RATE_THRESHOLDS.UNSTABLE_USEFUL_MIN &&
    b.wrongRate >= RATE_THRESHOLDS.UNSTABLE_WRONG_MIN
  ) {
    reasons.push(
      `Verdict split: usefulRate ${(b.usefulRate * 100).toFixed(1)}% and wrongRate ${(b.wrongRate * 100).toFixed(1)}% — context-dependent firing.`,
    );
    return { health: RuleHealth.UNSTABLE, reasons };
  }

  // Step 4: positive default. Healthy when both signals look good.
  if (
    b.usefulRate >= RATE_THRESHOLDS.HEALTHY_USEFUL_MIN &&
    b.wrongRate <= RATE_THRESHOLDS.HEALTHY_WRONG_MAX
  ) {
    reasons.push(`usefulRate ${(b.usefulRate * 100).toFixed(1)}% ≥ ${(RATE_THRESHOLDS.HEALTHY_USEFUL_MIN * 100).toFixed(0)}% and wrongRate ${(b.wrongRate * 100).toFixed(1)}% ≤ ${(RATE_THRESHOLDS.HEALTHY_WRONG_MAX * 100).toFixed(0)}%.`);
    return { health: RuleHealth.HEALTHY, reasons };
  }

  // Fallback: enough sample, no extreme signal in either direction —
  // closer to UNSTABLE than HEALTHY. Surface as UNSTABLE so admins
  // see it (not buried with HEALTHY).
  reasons.push(
    `usefulRate ${(b.usefulRate * 100).toFixed(1)}% does not meet HEALTHY threshold; wrongRate ${(b.wrongRate * 100).toFixed(1)}% does not meet TUNING threshold.`,
  );
  return { health: RuleHealth.UNSTABLE, reasons };
}

export function buildHooks(
  health: RuleHealth,
  b: RuleFeedbackBreakdownDto,
  ruleScore: number,
): RuleHealthHooksDto {
  // These hooks are advisory output today. None of them have a callsite
  // that mutates a rule. The shape is intentionally narrow so a future
  // auto-tuning service can read it without re-classifying.
  switch (health) {
    case RuleHealth.HEALTHY:
      return {
        recommendedAction: RuleRecommendedAction.NO_ACTION,
        proposedScoreFloor: ruleScore >= 75 ? ruleScore : null,
        proposedThresholdDelta: null,
        shouldConsiderDisable: false,
      };
    case RuleHealth.NEEDS_TUNING:
      return {
        recommendedAction: b.wrongRate >= 0.5
          ? RuleRecommendedAction.CONSIDER_DISABLE
          : RuleRecommendedAction.CONSIDER_TUNING,
        proposedScoreFloor: null,
        // Suggest tightening by ~10% — direction-only hint; magnitude is
        // illustrative, not tuned. A future phase reads AdminSetting for
        // the actual delta.
        proposedThresholdDelta: -0.1,
        shouldConsiderDisable: b.wrongRate >= 0.5,
      };
    case RuleHealth.UNSTABLE:
      return {
        recommendedAction: RuleRecommendedAction.REVIEW,
        proposedScoreFloor: null,
        proposedThresholdDelta: null,
        shouldConsiderDisable: false,
      };
    case RuleHealth.LOW_SIGNAL:
      return {
        recommendedAction: RuleRecommendedAction.COLLECT_MORE_DATA,
        proposedScoreFloor: null,
        proposedThresholdDelta: null,
        shouldConsiderDisable: false,
      };
  }
}

function summarize(entries: RuleHealthEntryDto[]): RuleHealthSummaryDto {
  const byHealth: Record<RuleHealth, number> = {
    [RuleHealth.HEALTHY]: 0,
    [RuleHealth.NEEDS_TUNING]: 0,
    [RuleHealth.UNSTABLE]: 0,
    [RuleHealth.LOW_SIGNAL]: 0,
  };
  let scoreSum = 0;
  let scoreCount = 0;
  for (const entry of entries) {
    byHealth[entry.health]++;
    if (entry.health !== RuleHealth.LOW_SIGNAL) {
      // Average score over rules with enough signal to be meaningful;
      // including LOW_SIGNAL would drag the average toward zero for
      // freshly-introduced rules.
      scoreSum += entry.ruleScore;
      scoreCount++;
    }
  }
  return {
    totalRules: entries.length,
    byHealth,
    averageRuleScore: scoreCount === 0 ? 0 : Math.round(scoreSum / scoreCount),
  };
}

function healthRank(h: RuleHealth): number {
  switch (h) {
    case RuleHealth.NEEDS_TUNING: return 0;
    case RuleHealth.UNSTABLE:     return 1;
    case RuleHealth.HEALTHY:      return 2;
    case RuleHealth.LOW_SIGNAL:   return 3;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
