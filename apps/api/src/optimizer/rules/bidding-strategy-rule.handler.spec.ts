import { ActionType, OptimizerRule, RuleComparator, PlatformScope, PhaseScope, RuleFamily } from '@prisma/client';
import { BiddingStrategyRuleHandler } from './bidding-strategy-rule.handler';
import { RuleHandlerContext } from './rule-handler.interface';

function makeRule(overrides: Partial<OptimizerRule> = {}): OptimizerRule {
  return {
    id: 'rule-bid-1',
    orgId: null,
    ruleFamily: 'BIDDING_STRATEGY' as RuleFamily,
    name: 'Switch to TARGET_ROAS when ROAS stable',
    description: null,
    isEnabled: true,
    priority: 50,
    kpiMetric: 'roas',
    comparator: 'GTE' as RuleComparator,
    thresholdValue: 2.5 as unknown as OptimizerRule['thresholdValue'],
    consecutiveWindows: 1,
    actionType: ActionType.SWITCH_BIDDING_STRATEGY,
    actionDelta: null,
    actionTargetValue: 'TARGET_ROAS',
    maxDeltaPerCycle: null,
    minSampleImpressions: 1000n as unknown as OptimizerRule['minSampleImpressions'],
    platformScope: 'ALL' as PlatformScope,
    appliesToPhase: 'ALL' as PhaseScope,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RuleHandlerContext> = {}): RuleHandlerContext {
  return {
    orgId: 'org-1',
    entityType: 'AD_SET',
    entityId: 'as-1',
    platform: 'META',
    adAccountId: 'acc-1',
    adAccountCurrency: 'SAR',
    metrics: { roas: 3.0, impressions24h: 5000 },
    currentBaseline: null,
    ...overrides,
  };
}

describe('BiddingStrategyRuleHandler', () => {
  const handler = new BiddingStrategyRuleHandler();

  it('proposes a SWITCH_BIDDING_STRATEGY action with the rule\'s targetValue', () => {
    const result = handler.evaluate(makeRule(), makeCtx());

    expect(result.kind).toBe('proposed');
    if (result.kind !== 'proposed') return;
    expect(result.action.actionType).toBe(ActionType.SWITCH_BIDDING_STRATEGY);
    expect(result.action.targetValue).toBe('TARGET_ROAS');
    expect(result.action.currentValue).toBeNull();
    expect(result.action.proposedValue).toBeNull();
    expect(result.action.explanation.en).toContain('TARGET_ROAS');
  });

  it('does not require currentBaseline (bid strategies do not have a numeric baseline)', () => {
    const result = handler.evaluate(makeRule(), makeCtx({ currentBaseline: null }));
    expect(result.kind).toBe('proposed');
  });

  it('skips with THRESHOLD_NOT_MET when KPI does not satisfy the comparator', () => {
    const ctx = makeCtx({ metrics: { roas: 1.0, impressions24h: 5000 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('THRESHOLD_NOT_MET');
  });

  it('skips with INSUFFICIENT_SAMPLE under min impressions', () => {
    const ctx = makeCtx({ metrics: { roas: 3.0, impressions24h: 50 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('INSUFFICIENT_SAMPLE');
  });

  it('declares only SWITCH_BIDDING_STRATEGY as supported', () => {
    expect(handler.supports.has(ActionType.SWITCH_BIDDING_STRATEGY)).toBe(true);
    expect(handler.supports.has(ActionType.INCREASE_BUDGET)).toBe(false);
    expect(handler.supports.has(ActionType.ADJUST_BID_FLOOR)).toBe(false);
  });
});
