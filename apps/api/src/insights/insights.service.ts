import { Injectable, Logger } from '@nestjs/common';
import { ActionType, CampaignPhase, OptimizerMode, OptimizerRule, Platform } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluatorService } from '../optimizer/evaluator.service';
import { ProposedAction } from '../optimizer/dto/proposed-action.dto';
import { SkipReason, EvaluationResult } from '../optimizer/rules/rule-handler.interface';
import { InsightDto, InsightSeverity, InsightType, InsightListResponseDto } from './dto/insight.dto';
import { InsightQueryDto } from './dto/insight-query.dto';
import { TrendAnalyzerService } from './trends/trend-analyzer.service';
import { SnapshotTriple, TrendSignal } from './trends/trend-types';
import { InsightScorerService, UnscoredInsight } from './scoring/insight-scorer.service';
import { InsightInteractionsService, InteractionsByInsightId } from './interactions/insight-interactions.service';

// Action types whose semantic intent is cost-cutting / risk-mitigation.
// Drives the PERFORMANCE_RISK vs OPTIMIZATION_OPPORTUNITY split.
const RISK_ACTIONS: ReadonlySet<ActionType> = new Set([
  ActionType.DECREASE_BUDGET,
  ActionType.ADJUST_BID_CEILING,
]);

interface CampaignWithAccount {
  id: string;
  name: string;
  orgId: string;
  platform: Platform;
  campaignPhase: CampaignPhase;
  optimizerMode: OptimizerMode;
  optimizerEnabled: boolean;
  isCbo: boolean;
  dailyBudget: { toNumber(): number } | number | null;
  status: string;
  adAccount: { id: string; currency: string };
}

interface AdSetWithCampaign {
  id: string;
  name: string;
  orgId: string;
  optimizerMode: OptimizerMode;
  optimizerEnabled: boolean;
  status: string;
  campaign: CampaignWithAccount;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private prisma: PrismaService,
    private evaluator: EvaluatorService,
    private trendAnalyzer: TrendAnalyzerService,
    private scorer: InsightScorerService,
    private interactions: InsightInteractionsService,
  ) {}

  // List insights for an entire org, optionally filtered by entity scope.
  // userId is the caller's user id; per-user interaction state is merged in.
  async listForOrg(orgId: string, userId: string, query: InsightQueryDto): Promise<InsightListResponseDto> {
    const insights = await this.compute(orgId, userId, null);
    return this.buildResponse(this.applyFilters(insights, query));
  }

  // List insights scoped to one campaign and its ad sets.
  async listForCampaign(orgId: string, userId: string, campaignId: string, query: InsightQueryDto): Promise<InsightListResponseDto> {
    const insights = await this.compute(orgId, userId, campaignId);
    return this.buildResponse(this.applyFilters(insights, query));
  }

  // Core: load entities + rules, run evaluator (read-only), translate to insights.
  // Provider-agnostic — never calls a provider, never writes to ad platforms.
  private async compute(orgId: string, userId: string, scopeCampaignId: string | null): Promise<InsightDto[]> {
    const [orgRules, globalRules] = await Promise.all([
      this.prisma.optimizerRule.findMany({ where: { orgId, isEnabled: true } }),
      this.prisma.optimizerRule.findMany({ where: { orgId: null, isEnabled: true } }),
    ]);
    const allRules: OptimizerRule[] = [...orgRules, ...globalRules];

    const campaignWhere = {
      orgId,
      ...(scopeCampaignId ? { id: scopeCampaignId } : {}),
      optimizerEnabled: true,
      optimizerMode: { not: OptimizerMode.OFF },
      status: 'ACTIVE' as const,
    };

    const campaigns = await this.prisma.campaign.findMany({
      where: campaignWhere,
      include: { adAccount: { select: { id: true, currency: true } } },
    });

    const adSets = await this.prisma.adSet.findMany({
      where: {
        orgId,
        ...(scopeCampaignId ? { campaignId: scopeCampaignId } : {}),
        optimizerEnabled: true,
        optimizerMode: { not: OptimizerMode.OFF },
        status: 'ACTIVE',
        campaign: { optimizerEnabled: true },
      },
      include: {
        campaign: { include: { adAccount: { select: { id: true, currency: true } } } },
      },
    });

    const unscored: UnscoredInsight[] = [];

    for (const campaign of campaigns as unknown as CampaignWithAccount[]) {
      const ent: EntityHeader = {
        entityType: 'CAMPAIGN',
        entityId: campaign.id,
        entityName: campaign.name,
        platform: campaign.platform,
        orgId: campaign.orgId,
      };

      if (campaign.campaignPhase === CampaignPhase.LEARNING) {
        unscored.push(this.buildLearningPhaseInsight(ent));
        continue;
      }

      const result = await this.evaluator.evaluateCampaign(campaign as never, allRules);
      this.appendFromEvaluation(unscored, ent, result, allRules.length);
      await this.appendTrendInsights(unscored, ent);
    }

    for (const adSet of adSets as unknown as AdSetWithCampaign[]) {
      const ent: EntityHeader = {
        entityType: 'AD_SET',
        entityId: adSet.id,
        entityName: adSet.name,
        platform: adSet.campaign.platform,
        orgId: adSet.orgId,
      };

      if (adSet.campaign.campaignPhase === CampaignPhase.LEARNING) {
        // Suppress per-ad-set LEARNING noise; the parent campaign already emits it.
        continue;
      }

      const result = await this.evaluator.evaluateAdSet(adSet as never, allRules);
      this.appendFromEvaluation(unscored, ent, result, allRules.length);
      await this.appendTrendInsights(unscored, ent);
    }

    // Load this user's existing interactions for the org in one query so the
    // merge below is O(1) per insight instead of round-tripping per row.
    const overlay = await this.interactions.getForOrgUser(orgId, userId);

    // Score, attach the per-user interaction overlay, then rank:
    // score desc → severity desc → name asc. Score is the primary key;
    // severity tiebreaks two insights with the same score.
    const insights: InsightDto[] = unscored.map((u) => ({
      ...u,
      ...this.scorer.score(u),
      ...this.overlayFor(u.id, overlay),
    }));
    insights.sort((a, b) =>
      b.score - a.score
      || severityRank(b.severity) - severityRank(a.severity)
      || a.entityName.localeCompare(b.entityName),
    );

    return insights;
  }

  // Translate one InsightInteraction row into the four overlay fields. Defaults
  // are all null when the user has never touched the insight.
  private overlayFor(insightId: string, overlay: InteractionsByInsightId): {
    userStatus: InsightDto['userStatus'];
    feedback: InsightDto['feedback'];
    userNote: InsightDto['userNote'];
    interactedAt: InsightDto['interactedAt'];
  } {
    const row = overlay.get(insightId);
    if (!row) return { userStatus: null, feedback: null, userNote: null, interactedAt: null };
    return {
      userStatus: row.status,
      feedback: row.feedback,
      userNote: row.note,
      interactedAt: row.updatedAt.toISOString(),
    };
  }

  private appendFromEvaluation(
    out: UnscoredInsight[],
    ent: EntityHeader,
    result: EvaluationResult | null,
    totalApplicableRules: number,
  ): void {
    // Evaluator returns { proposed: [], skipped: [] } when no metrics or LEARNING.
    // For non-LEARNING entities with totally empty results, surface INSUFFICIENT_DATA.
    if (!result || (result.proposed.length === 0 && result.skipped.length === 0)) {
      if (totalApplicableRules > 0) {
        out.push(this.buildNoMetricsInsight(ent));
      }
      return;
    }

    // Per-action insights: PERFORMANCE_RISK or OPTIMIZATION_OPPORTUNITY
    for (const proposed of result.proposed) {
      out.push(this.buildProposedInsight(ent, proposed));
    }

    // Per-entity rollup: READY_FOR_ACTION (one summary, not per-action)
    if (result.proposed.length > 0) {
      out.push(this.buildReadyForActionInsight(ent, result.proposed));
    }

    // Group skipped reasons by code so we don't flood the UI with one row per rule.
    const groupedSkips = groupSkipsByCode(result.skipped);
    for (const [code, group] of groupedSkips) {
      out.push(this.buildSkipInsight(ent, code, group));
    }
  }

  // ─── Insight constructors ─────────────────────────────────────────────────

  private buildLearningPhaseInsight(ent: EntityHeader): UnscoredInsight {
    return {
      id: this.idFor(ent, 'learning'),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType: InsightType.LEARNING_PHASE,
      severity: InsightSeverity.INFO,
      title: { en: `${ent.entityName} is in the learning phase`, ar: null },
      description: {
        en: `Platform delivery is still calibrating. The optimizer will not act on this ${ent.entityType.toLowerCase()} until it transitions out of LEARNING.`,
        ar: null,
      },
      context: { phase: 'LEARNING' },
      relatedRuleId: null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildNoMetricsInsight(ent: EntityHeader): UnscoredInsight {
    return {
      id: this.idFor(ent, 'no-metrics'),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType: InsightType.INSUFFICIENT_DATA,
      severity: InsightSeverity.LOW,
      title: { en: `No metrics yet for ${ent.entityName}`, ar: null },
      description: {
        en: `No 24h metric snapshot is available, so no rules can be evaluated. Confirm the metric ingestion job has run for this ${ent.entityType.toLowerCase()}.`,
        ar: null,
      },
      context: { reason: 'no_24h_snapshot' },
      relatedRuleId: null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildProposedInsight(ent: EntityHeader, p: ProposedAction): UnscoredInsight {
    const isRisk = RISK_ACTIONS.has(p.actionType);
    const insightType = isRisk ? InsightType.PERFORMANCE_RISK : InsightType.OPTIMIZATION_OPPORTUNITY;
    const severity = isRisk ? InsightSeverity.HIGH : InsightSeverity.MEDIUM;
    const verb = isRisk ? 'Risk detected' : 'Opportunity detected';

    return {
      id: this.idFor(ent, `proposed:${p.ruleId}:${p.actionType}`),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType,
      severity,
      title: { en: `${verb} on ${ent.entityName}`, ar: null },
      description: p.explanation,
      context: {
        actionType: p.actionType,
        deltaPct: p.deltaPct,
        currentValue: p.currentValue,
        proposedValue: p.proposedValue,
        targetValue: p.targetValue,
        currency: p.adAccountCurrency,
      },
      relatedRuleId: p.ruleId,
      relatedActionType: p.actionType,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildReadyForActionInsight(ent: EntityHeader, proposed: ProposedAction[]): UnscoredInsight {
    const hasRisk = proposed.some((p) => RISK_ACTIONS.has(p.actionType));
    const severity = hasRisk ? InsightSeverity.HIGH : InsightSeverity.MEDIUM;

    return {
      id: this.idFor(ent, 'ready-for-action'),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType: InsightType.READY_FOR_ACTION,
      severity,
      title: {
        en: `${proposed.length} action${proposed.length === 1 ? '' : 's'} pending review on ${ent.entityName}`,
        ar: null,
      },
      description: {
        en: `The optimizer has identified ${proposed.length} change${proposed.length === 1 ? '' : 's'} that an admin can approve. No changes have been applied.`,
        ar: null,
      },
      context: {
        proposedCount: proposed.length,
        actionTypes: [...new Set(proposed.map((p) => p.actionType))],
        ruleIds: [...new Set(proposed.map((p) => p.ruleId))],
      },
      relatedRuleId: null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildSkipInsight(ent: EntityHeader, code: SkipReason['code'], group: SkipReason[]): UnscoredInsight {
    const ruleIds = [...new Set(group.map((s) => s.ruleId))];
    const isDataGap = code === 'INSUFFICIENT_SAMPLE' || code === 'KPI_MISSING';

    const insightType: InsightType = isDataGap
      ? InsightType.INSUFFICIENT_DATA
      : InsightType.RULE_NOT_TRIGGERED;
    const severity: InsightSeverity = isDataGap ? InsightSeverity.LOW : InsightSeverity.INFO;

    const title: Record<SkipReason['code'], string> = {
      KPI_MISSING:        `Missing KPI data on ${ent.entityName}`,
      INSUFFICIENT_SAMPLE: `Not enough impressions on ${ent.entityName}`,
      THRESHOLD_NOT_MET:   `${group.length} rule${group.length === 1 ? '' : 's'} did not trigger on ${ent.entityName}`,
      MISSING_BASELINE:    `Baseline value unavailable on ${ent.entityName}`,
      NOT_APPLICABLE:      `${group.length} rule${group.length === 1 ? '' : 's'} not applicable on ${ent.entityName}`,
    };

    const description: Record<SkipReason['code'], string> = {
      KPI_MISSING:         `${group.length} rule${group.length === 1 ? '' : 's'} could not run because the requested KPI has no value yet.`,
      INSUFFICIENT_SAMPLE: `${group.length} rule${group.length === 1 ? '' : 's'} were skipped because the 24h sample size is below the minimum impressions threshold.`,
      THRESHOLD_NOT_MET:   `KPI values are within healthy range — no rule conditions met yet.`,
      MISSING_BASELINE:    `${group.length} rule${group.length === 1 ? '' : 's'} matched but no current baseline value (e.g. budget) is loaded for this ${ent.entityType.toLowerCase()}.`,
      NOT_APPLICABLE:      `${group.length} rule${group.length === 1 ? '' : 's'} did not apply to this entity in its current state.`,
    };

    return {
      id: this.idFor(ent, `skip:${code}`),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType,
      severity,
      title: { en: title[code], ar: null },
      description: { en: description[code], ar: null },
      context: {
        skipCode: code,
        affectedRuleIds: ruleIds,
        ruleCount: group.length,
        details: group.map((s) => ({ ruleId: s.ruleId, actionType: s.actionType, ...s.context })),
      },
      relatedRuleId: ruleIds.length === 1 ? ruleIds[0] : null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Trend & Pattern Intelligence ─────────────────────────────────────────

  // Loads the 24/48/72h snapshot triple for one entity and translates trend
  // signals into insights. Behavior-driven: works alongside the rule-based
  // path without modifying any rule/evaluator logic.
  private async appendTrendInsights(out: UnscoredInsight[], ent: EntityHeader): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshots = await this.prisma.metricSnapshot.findMany({
      where: { entityType: ent.entityType, entityId: ent.entityId, snapshotDate: today },
      orderBy: { windowHours: 'asc' },
    });

    const w24 = snapshots.find((s) => s.windowHours === 24) ?? null;
    const w48 = snapshots.find((s) => s.windowHours === 48) ?? null;
    const w72 = snapshots.find((s) => s.windowHours === 72) ?? null;
    const triple: SnapshotTriple = { window24h: w24, window48h: w48, window72h: w72 };
    const impressions24h = w24 ? Number(w24.impressions) : 0;

    const signals = this.trendAnalyzer.analyze(triple, impressions24h);
    if (signals.length === 0) return;

    // Per-metric directional / volatile insights.
    for (const signal of signals) {
      if (signal.direction === 'UP' || signal.direction === 'DOWN') {
        out.push(this.buildTrendDirectionInsight(ent, signal));
      } else if (signal.direction === 'VOLATILE') {
        out.push(this.buildVolatilityInsight(ent, signal));
      }
    }

    // Stagnation: only emit when at least 2 metrics are flat — single-metric
    // flatness is not a strong enough signal to surface on its own.
    const flatMetrics = signals.filter((s) => s.direction === 'FLAT');
    if (flatMetrics.length >= 2) {
      out.push(this.buildStagnantInsight(ent, flatMetrics));
    }
  }

  private buildTrendDirectionInsight(ent: EntityHeader, s: TrendSignal): UnscoredInsight {
    const isUp = s.direction === 'UP';
    const insightType = isUp ? InsightType.TREND_UP : InsightType.TREND_DOWN;
    const severity = isUp
      ? InsightSeverity.INFO
      : s.confidence === 'HIGH' ? InsightSeverity.HIGH
        : s.confidence === 'MEDIUM' ? InsightSeverity.MEDIUM
          : InsightSeverity.LOW;

    const metric = s.metric.toUpperCase();
    const pct = s.performanceChangePct ?? 0;
    const arrow = isUp ? 'improving' : 'degrading';
    const title = isUp
      ? `${metric} is improving on ${ent.entityName}`
      : `${metric} is degrading on ${ent.entityName}`;
    const description =
      `${ent.entityName}'s ${metric} is ${arrow} — performance change ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% across the 72h window ` +
      `(${s.values.window72h.toFixed(2)} → ${s.values.window48h.toFixed(2)} → ${s.values.window24h.toFixed(2)}). ` +
      `Confidence: ${s.confidence}. ${s.rationale}`;

    return {
      id: this.idFor(ent, `trend:${s.direction}:${s.metric}`),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType,
      severity,
      title: { en: title, ar: null },
      description: { en: description, ar: null },
      context: {
        metric: s.metric,
        direction: s.direction,
        performanceChangePct: s.performanceChangePct,
        confidence: s.confidence,
        higherIsBetter: s.higherIsBetter,
        values: s.values,
      },
      relatedRuleId: null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildVolatilityInsight(ent: EntityHeader, s: TrendSignal): UnscoredInsight {
    const metric = s.metric.toUpperCase();
    const severity = s.confidence === 'HIGH' ? InsightSeverity.MEDIUM : InsightSeverity.LOW;
    const description =
      `${ent.entityName}'s ${metric} swung between windows ` +
      `(${s.values.window72h.toFixed(2)} → ${s.values.window48h.toFixed(2)} → ${s.values.window24h.toFixed(2)}), ` +
      `suggesting unstable delivery. Confidence: ${s.confidence}. ${s.rationale}`;

    return {
      id: this.idFor(ent, `trend:VOLATILE:${s.metric}`),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType: InsightType.VOLATILITY_HIGH,
      severity,
      title: { en: `${metric} volatility on ${ent.entityName}`, ar: null },
      description: { en: description, ar: null },
      context: {
        metric: s.metric,
        direction: s.direction,
        confidence: s.confidence,
        values: s.values,
      },
      relatedRuleId: null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildStagnantInsight(ent: EntityHeader, flat: TrendSignal[]): UnscoredInsight {
    const metricList = flat.map((s) => s.metric.toUpperCase()).join(', ');
    const description =
      `${ent.entityName}'s ${metricList} have remained flat (<3% step change) across the 72h window — ` +
      `neither improving nor degrading. Consider whether new creative, audience, or budget changes are needed to break the plateau.`;

    return {
      id: this.idFor(ent, 'trend:STAGNANT'),
      orgId: ent.orgId,
      entityType: ent.entityType,
      entityId: ent.entityId,
      entityName: ent.entityName,
      platform: ent.platform,
      insightType: InsightType.PERFORMANCE_STAGNANT,
      severity: InsightSeverity.LOW,
      title: { en: `${ent.entityName} performance is stagnant`, ar: null },
      description: { en: description, ar: null },
      context: {
        flatMetrics: flat.map((s) => s.metric),
        details: flat.map((s) => ({ metric: s.metric, values: s.values })),
      },
      relatedRuleId: null,
      relatedActionType: null,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private applyFilters(insights: InsightDto[], q: InsightQueryDto): InsightDto[] {
    return insights.filter((i) => {
      if (q.platform && i.platform !== q.platform) return false;
      if (q.severity && i.severity !== q.severity) return false;
      if (q.insightType && i.insightType !== q.insightType) return false;
      // q.window — reserved, currently a no-op
      return true;
    });
  }

  private buildResponse(insights: InsightDto[]): InsightListResponseDto {
    const totals = { info: 0, low: 0, medium: 0, high: 0 };
    for (const i of insights) {
      if (i.severity === InsightSeverity.INFO) totals.info++;
      else if (i.severity === InsightSeverity.LOW) totals.low++;
      else if (i.severity === InsightSeverity.MEDIUM) totals.medium++;
      else if (i.severity === InsightSeverity.HIGH) totals.high++;
    }
    return { insights, totals, generatedAt: new Date().toISOString() };
  }

  private idFor(ent: EntityHeader, source: string): string {
    const hash = createHash('sha1')
      .update(`${ent.orgId}:${ent.entityType}:${ent.entityId}:${source}`)
      .digest('hex');
    return `ins_${hash.slice(0, 24)}`;
  }
}

// ─── Local helpers ──────────────────────────────────────────────────────────

interface EntityHeader {
  orgId: string;
  entityType: 'CAMPAIGN' | 'AD_SET';
  entityId: string;
  entityName: string;
  platform: Platform;
}

function severityRank(s: InsightSeverity): number {
  switch (s) {
    case InsightSeverity.HIGH:   return 4;
    case InsightSeverity.MEDIUM: return 3;
    case InsightSeverity.LOW:    return 2;
    case InsightSeverity.INFO:   return 1;
  }
}

function groupSkipsByCode(skips: SkipReason[]): Map<SkipReason['code'], SkipReason[]> {
  const map = new Map<SkipReason['code'], SkipReason[]>();
  for (const s of skips) {
    const arr = map.get(s.code) ?? [];
    arr.push(s);
    map.set(s.code, arr);
  }
  return map;
}
