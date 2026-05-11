import { Injectable } from '@nestjs/common';
import { OptimizerAction, OptimizerRule, RuleComparator } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RulePerformanceService } from './rule-performance.service';
import { RuleHealthEntryDto, RuleHealthResponseDto } from './rule-performance.dto';
import { RuleHealth } from './rule-performance.types';
import {
  RuleSimulationActionDto,
  RuleSimulationEntryDto,
  RuleSimulationImpactDto,
  RuleSimulationResponseDto,
  RuleSimulationSummaryDto,
  SimulatedActionType,
  SimulationConfidence,
} from './rule-tuner-simulation.dto';

// Shadow auto-tuning. This service consumes the advisory hooks emitted by
// RulePerformanceService (Phase G) and projects what the system *would* do
// if those hooks were enacted. It must NEVER write to optimizer_rules,
// insight_interactions, or any external system. Calling Prisma is read-only;
// the response is computed in-memory from the read aggregates.
//
// Design notes:
//   1. The simulation is grounded against historical OptimizerActions, not
//      ad-hoc heuristics. For TIGHTEN_THRESHOLD we replay each action's
//      stored evaluation_context against a hypothetical new threshold.
//   2. When evaluation_context lacks the required KPI key, the action is
//      counted as INDETERMINATE — neither suppressed nor kept — and that
//      count drives the per-rule confidence band. This keeps "we don't
//      know" honest instead of inventing a verdict.
//   3. Confidence is independent of the rule-health confidence: the
//      health classifier looks at feedback sample size; the simulation
//      looks at action sample size + indeterminate ratio.
//   4. The response is explicitly tagged isShadowMode: true so any
//      consumer (admin UI, alerts) can never confuse it with a applied
//      change.
const DEFAULT_LOOKBACK_DAYS = 30;
const HIGH_CONFIDENCE_ACTION_COUNT = 30;
const MEDIUM_CONFIDENCE_ACTION_COUNT = 10;
const HIGH_CONFIDENCE_INDETERMINATE_RATIO = 0.1;

@Injectable()
export class RuleTunerSimulationService {
  constructor(
    private prisma: PrismaService,
    private rulePerformance: RulePerformanceService,
  ) {}

  async getForOrg(orgId: string, lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<RuleSimulationResponseDto> {
    const health = await this.rulePerformance.getForOrg(orgId);
    return this.simulate(health, { orgId }, lookbackDays);
  }

  async getForAllOrgs(lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<RuleSimulationResponseDto> {
    const health = await this.rulePerformance.getForAllOrgs();
    return this.simulate(health, {}, lookbackDays);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async simulate(
    health: RuleHealthResponseDto,
    actionScope: { orgId?: string },
    lookbackDays: number,
  ): Promise<RuleSimulationResponseDto> {
    const ruleIds = health.rules.map((r) => r.ruleId);
    if (ruleIds.length === 0) {
      return {
        scope: health.scope,
        lookbackDays,
        summary: emptySummary(),
        rules: [],
        isShadowMode: true,
        uncategorizedCount: health.uncategorizedCount,
        generatedAt: new Date().toISOString(),
      };
    }

    const since = new Date(Date.now() - lookbackDays * 86_400_000);

    const [ruleDefs, actions] = await Promise.all([
      this.prisma.optimizerRule.findMany({ where: { id: { in: ruleIds } } }),
      this.prisma.optimizerAction.findMany({
        where: {
          ruleId: { in: ruleIds },
          createdAt: { gte: since },
          ...(actionScope.orgId ? { orgId: actionScope.orgId } : {}),
        },
        select: {
          id: true,
          ruleId: true,
          evaluationContext: true,
          createdAt: true,
        },
      }),
    ]);

    const ruleDefsById = new Map<string, OptimizerRuleLike>(
      ruleDefs.map((r) => [r.id, normalizeRuleDef(r)]),
    );
    const actionsByRule = new Map<string, ActionLike[]>();
    for (const a of actions) {
      if (!a.ruleId) continue;
      const arr = actionsByRule.get(a.ruleId) ?? [];
      arr.push({ id: a.id, evaluationContext: a.evaluationContext });
      actionsByRule.set(a.ruleId, arr);
    }

    const entries = health.rules.map((entry) =>
      simulateRule(entry, ruleDefsById.get(entry.ruleId), actionsByRule.get(entry.ruleId) ?? []),
    );

    return {
      scope: health.scope,
      lookbackDays,
      summary: summarize(entries),
      rules: entries,
      isShadowMode: true,
      uncategorizedCount: health.uncategorizedCount,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

// Decoupled from Prisma so tests can pass plain objects.
export interface OptimizerRuleLike {
  id: string;
  kpiMetric: string;
  comparator: RuleComparator;
  thresholdValue: number;
}

export interface ActionLike {
  id: string;
  evaluationContext: unknown;
}

export function simulateRule(
  entry: RuleHealthEntryDto,
  ruleDef: OptimizerRuleLike | undefined,
  recentActions: ActionLike[],
): RuleSimulationEntryDto {
  const action = decideAction(entry, ruleDef);
  const impact = projectImpact(entry, ruleDef, recentActions, action);
  return {
    ruleId: entry.ruleId,
    scope: entry.scope,
    currentHealth: entry.health,
    currentRuleScore: entry.ruleScore,
    action,
    impact,
  };
}

export function decideAction(
  entry: RuleHealthEntryDto,
  ruleDef: OptimizerRuleLike | undefined,
): RuleSimulationActionDto {
  const h = entry.hooks;

  if (h.shouldConsiderDisable) {
    return {
      type: SimulatedActionType.DISABLE_RULE,
      description: `Rule would be disabled. Persistent wrongRate ${(entry.breakdown.wrongRate * 100).toFixed(1)}% exceeds the disable threshold.`,
      proposedThresholdDelta: null,
      projectedNewThreshold: null,
      proposedScoreFloor: null,
      shouldDisable: true,
    };
  }

  if (h.proposedThresholdDelta !== null) {
    const projectedNewThreshold = ruleDef
      ? round4(applyTighteningDelta(ruleDef.thresholdValue, ruleDef.comparator, h.proposedThresholdDelta))
      : null;
    return {
      type: SimulatedActionType.TIGHTEN_THRESHOLD,
      description:
        `Threshold would be tightened by ${(Math.abs(h.proposedThresholdDelta) * 100).toFixed(0)}%` +
        (ruleDef ? ` (${ruleDef.thresholdValue} → ${projectedNewThreshold}).` : ' (rule definition unavailable).'),
      proposedThresholdDelta: h.proposedThresholdDelta,
      projectedNewThreshold,
      proposedScoreFloor: null,
      shouldDisable: false,
    };
  }

  if (h.proposedScoreFloor !== null) {
    return {
      type: SimulatedActionType.RAISE_SCORE_FLOOR,
      description: `Insights from this rule would receive a score floor of ${h.proposedScoreFloor}.`,
      proposedThresholdDelta: null,
      projectedNewThreshold: null,
      proposedScoreFloor: h.proposedScoreFloor,
      shouldDisable: false,
    };
  }

  return {
    type: SimulatedActionType.NO_CHANGE,
    description:
      entry.health === RuleHealth.UNSTABLE
        ? 'Verdict is split — manual review recommended; no automatic change simulated.'
        : entry.health === RuleHealth.LOW_SIGNAL
        ? 'Insufficient feedback to simulate a change.'
        : 'Rule is healthy with no proposed score floor.',
    proposedThresholdDelta: null,
    projectedNewThreshold: null,
    proposedScoreFloor: null,
    shouldDisable: false,
  };
}

export function projectImpact(
  entry: RuleHealthEntryDto,
  ruleDef: OptimizerRuleLike | undefined,
  recentActions: ActionLike[],
  action: RuleSimulationActionDto,
): RuleSimulationImpactDto {
  const baseline: RuleSimulationImpactDto = {
    currentInteractionCount: entry.breakdown.interactionCount,
    currentActionCount: recentActions.length,
    projectedActionCount: recentActions.length,
    projectedActionDelta: 0,
    suppressedActionCount: 0,
    indeterminateActionCount: 0,
    confidence: pickConfidence(recentActions.length, 0),
    notes: [],
  };

  switch (action.type) {
    case SimulatedActionType.DISABLE_RULE:
      return {
        ...baseline,
        projectedActionCount: 0,
        projectedActionDelta: -recentActions.length,
        suppressedActionCount: recentActions.length,
        confidence: pickConfidence(recentActions.length, 0),
        notes: [
          `Disabling the rule would suppress every firing — projected delta is the full ${recentActions.length}-action history in the lookback window.`,
        ],
      };

    case SimulatedActionType.TIGHTEN_THRESHOLD: {
      if (!ruleDef) {
        return {
          ...baseline,
          notes: [
            'Rule definition is unavailable, so historical actions could not be re-evaluated. Treating impact as indeterminate.',
          ],
          indeterminateActionCount: recentActions.length,
          confidence: SimulationConfidence.LOW,
        };
      }

      const newThreshold = applyTighteningDelta(
        ruleDef.thresholdValue,
        ruleDef.comparator,
        action.proposedThresholdDelta!,
      );

      let suppressed = 0;
      let kept = 0;
      let indeterminate = 0;
      for (const a of recentActions) {
        const kpi = readKpiValue(a.evaluationContext, ruleDef.kpiMetric);
        if (kpi === null) {
          indeterminate++;
          continue;
        }
        if (compare(kpi, ruleDef.comparator, newThreshold)) {
          kept++;
        } else {
          suppressed++;
        }
      }

      const projected = kept + indeterminate;
      return {
        ...baseline,
        projectedActionCount: projected,
        projectedActionDelta: projected - recentActions.length,
        suppressedActionCount: suppressed,
        indeterminateActionCount: indeterminate,
        confidence: pickConfidence(recentActions.length, indeterminate),
        notes: [
          `Threshold ${ruleDef.thresholdValue} → ${round4(newThreshold)} (comparator ${ruleDef.comparator}).`,
          `Replayed ${recentActions.length} historical action(s): ${kept} would still fire, ${suppressed} would be suppressed, ${indeterminate} indeterminate.`,
        ],
      };
    }

    case SimulatedActionType.RAISE_SCORE_FLOOR:
      return {
        ...baseline,
        notes: [
          `Score floor only — affects insight ranking, not rule firing. ${recentActions.length} historical action(s) unaffected.`,
        ],
      };

    case SimulatedActionType.NO_CHANGE:
      return {
        ...baseline,
        notes: ['No simulated change — rule continues to fire as today.'],
      };
  }
}

export function applyTighteningDelta(
  threshold: number,
  comparator: RuleComparator,
  delta: number,
): number {
  // delta is signed (negative = "tighten") but the direction we apply
  // depends on the comparator. For a GT/GTE rule, "tighten" means raise
  // the threshold (fewer matches). For LT/LTE, "tighten" means lower it.
  // EQ is treated as a no-op since a multiplicative tighten doesn't have
  // a meaningful interpretation for equality matching.
  const magnitude = Math.abs(delta);
  switch (comparator) {
    case RuleComparator.GT:
    case RuleComparator.GTE:
      return threshold * (1 + magnitude);
    case RuleComparator.LT:
    case RuleComparator.LTE:
      return threshold * (1 - magnitude);
    case RuleComparator.EQ:
      return threshold;
  }
}

export function compare(value: number, comparator: RuleComparator, threshold: number): boolean {
  switch (comparator) {
    case RuleComparator.GT:  return value >  threshold;
    case RuleComparator.GTE: return value >= threshold;
    case RuleComparator.LT:  return value <  threshold;
    case RuleComparator.LTE: return value <= threshold;
    case RuleComparator.EQ:  return value === threshold;
  }
}

export function readKpiValue(context: unknown, kpiMetric: string): number | null {
  if (!context || typeof context !== 'object') return null;
  const ctx = context as Record<string, unknown>;
  const direct = ctx[kpiMetric];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  // Common nested shape from the optimizer: { metrics: { cpa: 52.3, ... } }
  const nested = ctx.metrics;
  if (nested && typeof nested === 'object') {
    const v = (nested as Record<string, unknown>)[kpiMetric];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function pickConfidence(actionCount: number, indeterminateCount: number): SimulationConfidence {
  if (actionCount === 0) return SimulationConfidence.LOW;
  const indeterminateRatio = indeterminateCount / actionCount;
  if (actionCount >= HIGH_CONFIDENCE_ACTION_COUNT && indeterminateRatio < HIGH_CONFIDENCE_INDETERMINATE_RATIO) {
    return SimulationConfidence.HIGH;
  }
  if (actionCount >= MEDIUM_CONFIDENCE_ACTION_COUNT) {
    return SimulationConfidence.MEDIUM;
  }
  return SimulationConfidence.LOW;
}

function summarize(entries: RuleSimulationEntryDto[]): RuleSimulationSummaryDto {
  const rulesByAction: Record<SimulatedActionType, number> = {
    [SimulatedActionType.NO_CHANGE]: 0,
    [SimulatedActionType.TIGHTEN_THRESHOLD]: 0,
    [SimulatedActionType.DISABLE_RULE]: 0,
    [SimulatedActionType.RAISE_SCORE_FLOOR]: 0,
  };
  let totalCurrentActions = 0;
  let totalProjectedActionDelta = 0;
  let totalCurrentInteractions = 0;
  let highConfidenceRuleCount = 0;
  for (const e of entries) {
    rulesByAction[e.action.type]++;
    totalCurrentActions += e.impact.currentActionCount;
    totalProjectedActionDelta += e.impact.projectedActionDelta;
    totalCurrentInteractions += e.impact.currentInteractionCount;
    if (e.impact.confidence === SimulationConfidence.HIGH) highConfidenceRuleCount++;
  }
  return {
    totalRules: entries.length,
    rulesByAction,
    totalCurrentInteractions,
    totalCurrentActions,
    totalProjectedActionDelta,
    highConfidenceRuleCount,
  };
}

function emptySummary(): RuleSimulationSummaryDto {
  return {
    totalRules: 0,
    rulesByAction: {
      [SimulatedActionType.NO_CHANGE]: 0,
      [SimulatedActionType.TIGHTEN_THRESHOLD]: 0,
      [SimulatedActionType.DISABLE_RULE]: 0,
      [SimulatedActionType.RAISE_SCORE_FLOOR]: 0,
    },
    totalCurrentInteractions: 0,
    totalCurrentActions: 0,
    totalProjectedActionDelta: 0,
    highConfidenceRuleCount: 0,
  };
}

function normalizeRuleDef(r: OptimizerRule): OptimizerRuleLike {
  // Prisma Decimal → number; safe because thresholdValue is bounded.
  return {
    id: r.id,
    kpiMetric: r.kpiMetric,
    comparator: r.comparator,
    thresholdValue: Number(r.thresholdValue),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
