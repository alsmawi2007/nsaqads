import { Injectable } from '@nestjs/common';
import { ActionType, OptimizerRule } from '@prisma/client';
import { BaseRuleHandler } from './base-rule.handler';
import { RuleHandlerContext, RuleHandlerResult } from './rule-handler.interface';

@Injectable()
export class BiddingStrategyRuleHandler extends BaseRuleHandler {
  readonly supports = new Set<ActionType>([ActionType.SWITCH_BIDDING_STRATEGY]);

  protected applyTriggered(
    rule: OptimizerRule,
    ctx: RuleHandlerContext,
    kpiValue: number,
    threshold: number,
  ): RuleHandlerResult {
    const explanation = this.buildExplanation(rule, kpiValue, threshold);

    return {
      kind: 'proposed',
      action: {
        orgId: ctx.orgId,
        ruleId: rule.id,
        entityType: ctx.entityType,
        entityId: ctx.entityId,
        platform: ctx.platform,
        actionType: rule.actionType,
        deltaPct: rule.actionDelta !== null ? Number(rule.actionDelta) : null,
        targetValue: rule.actionTargetValue,
        currentValue: null,
        proposedValue: null,
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
  ): { en: string; ar: null } {
    const kpi = rule.kpiMetric.toUpperCase();
    const action = rule.actionType.replace(/_/g, ' ').toLowerCase();
    const tail = rule.actionTargetValue
      ? `Action: ${action} to ${rule.actionTargetValue}.`
      : `Action: ${action}.`;
    const en = `Rule "${rule.name}" triggered: ${kpi} was ${kpiValue.toFixed(2)} (threshold: ${rule.comparator} ${threshold}). ${tail}`;
    return { en, ar: null };
  }
}
