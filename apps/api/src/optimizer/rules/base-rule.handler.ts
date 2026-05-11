import { ActionType, OptimizerRule } from '@prisma/client';
import { compare } from './comparator.util';
import {
  IRuleHandler,
  RuleHandlerContext,
  RuleHandlerResult,
  SkipReason,
  SkipReasonCode,
} from './rule-handler.interface';

// Shared pre-checks every handler runs in the same order:
//   1. Is the requested KPI present on the entity's metrics?
//   2. Does the 24h sample meet the rule's minSampleImpressions?
//   3. Does the comparator + threshold actually fire?
// Each pre-check emits a typed SkipReason so the Insights layer can
// surface "why didn't this rule fire?" without re-running the engine.
export abstract class BaseRuleHandler implements IRuleHandler {
  abstract readonly supports: ReadonlySet<ActionType>;

  evaluate(rule: OptimizerRule, ctx: RuleHandlerContext): RuleHandlerResult {
    const kpiValue = ctx.metrics[rule.kpiMetric];

    if (kpiValue === null || kpiValue === undefined) {
      return this.skip(rule, ctx, 'KPI_MISSING', {
        en: `Rule "${rule.name}" did not fire: KPI "${rule.kpiMetric}" has no value for this entity.`,
        ar: null,
      }, { kpiMetric: rule.kpiMetric });
    }

    const minSample = Number(rule.minSampleImpressions);
    const impressions = Number(ctx.metrics['impressions24h'] ?? 0);
    if (impressions < minSample) {
      return this.skip(rule, ctx, 'INSUFFICIENT_SAMPLE', {
        en: `Rule "${rule.name}" did not fire: only ${impressions} impressions in the last 24h (minimum ${minSample}).`,
        ar: null,
      }, { impressions24h: impressions, minSampleImpressions: minSample });
    }

    const threshold = Number(rule.thresholdValue);
    if (!compare(kpiValue, rule.comparator, threshold)) {
      return this.skip(rule, ctx, 'THRESHOLD_NOT_MET', {
        en: `Rule "${rule.name}" did not fire: ${rule.kpiMetric.toUpperCase()} was ${kpiValue.toFixed(2)} (needed ${rule.comparator} ${threshold}).`,
        ar: null,
      }, { kpiValue, comparator: rule.comparator, threshold });
    }

    return this.applyTriggered(rule, ctx, kpiValue, threshold);
  }

  // Concrete handlers implement this to compute proposedValue / explanation
  // for their action family. Pre-checks above guarantee the rule has fired.
  protected abstract applyTriggered(
    rule: OptimizerRule,
    ctx: RuleHandlerContext,
    kpiValue: number,
    threshold: number,
  ): RuleHandlerResult;

  protected skip(
    rule: OptimizerRule,
    ctx: RuleHandlerContext,
    code: SkipReasonCode,
    reason: { en: string; ar: null },
    context?: Record<string, unknown>,
  ): RuleHandlerResult {
    const skip: SkipReason = {
      ruleId: rule.id,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      actionType: rule.actionType,
      code,
      reason,
      context,
    };
    return { kind: 'skipped', reason: skip };
  }
}
