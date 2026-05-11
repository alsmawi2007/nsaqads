import { Injectable } from '@nestjs/common';
import { ActionType, OptimizerRule } from '@prisma/client';
import { applyDelta } from '../../common/utils/currency.util';
import { BaseRuleHandler } from './base-rule.handler';
import { RuleHandlerContext, RuleHandlerResult } from './rule-handler.interface';

@Injectable()
export class BudgetRuleHandler extends BaseRuleHandler {
  readonly supports = new Set<ActionType>([
    ActionType.INCREASE_BUDGET,
    ActionType.DECREASE_BUDGET,
  ]);

  protected applyTriggered(
    rule: OptimizerRule,
    ctx: RuleHandlerContext,
    kpiValue: number,
    threshold: number,
  ): RuleHandlerResult {
    const deltaPct = rule.actionDelta !== null ? Number(rule.actionDelta) : null;

    // Budget actions are only meaningful when we know the current absolute
    // value. For ad-set rules under a CBO campaign the parent filters this
    // out upstream; for ad-set rules in non-CBO campaigns the evaluator
    // currently does not load adSet.dailyBudget — emit MISSING_BASELINE so
    // the Insights layer can surface this gap.
    if (deltaPct === null || ctx.currentBaseline === null) {
      return this.skip(rule, ctx, 'MISSING_BASELINE', {
        en: `Rule "${rule.name}" matched but no current budget baseline is available for this ${ctx.entityType.toLowerCase()}.`,
        ar: null,
      }, { hasDelta: deltaPct !== null, hasBaseline: ctx.currentBaseline !== null });
    }

    const proposedValue = applyDelta(ctx.currentBaseline, deltaPct, ctx.adAccountCurrency);
    const explanation = this.buildExplanation(rule, kpiValue, threshold, ctx, proposedValue);

    return {
      kind: 'proposed',
      action: {
        orgId: ctx.orgId,
        ruleId: rule.id,
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        platform: ctx.platform,
        actionType: rule.actionType,
        deltaPct,
        targetValue: rule.actionTargetValue,
        currentValue: ctx.currentBaseline,
        proposedValue,
        explanation,
        rulePriority: rule.priority,
        adAccountId: ctx.adAccountId,
        adAccountCurrency: ctx.adAccountCurrency,
      },
    };
  }

  private buildExplanation(
    rule: OptimizerRule,
    kpiValue: number,
    threshold: number,
    ctx: RuleHandlerContext,
    proposedValue: number,
  ): { en: string; ar: null } {
    const kpi = rule.kpiMetric.toUpperCase();
    const action = rule.actionType.replace(/_/g, ' ').toLowerCase();
    const en = `Rule "${rule.name}" triggered: ${kpi} was ${kpiValue.toFixed(2)} (threshold: ${rule.comparator} ${threshold}). ` +
      `Action: ${action} from ${ctx.adAccountCurrency} ${ctx.currentBaseline!.toFixed(2)} to ${ctx.adAccountCurrency} ${proposedValue.toFixed(2)}.`;
    return { en, ar: null };
  }
}
