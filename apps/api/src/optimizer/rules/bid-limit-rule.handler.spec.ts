import { ActionType, OptimizerRule, RuleComparator, PlatformScope, PhaseScope, RuleFamily } from '@prisma/client';
import { BidLimitRuleHandler } from './bid-limit-rule.handler';
import { RuleHandlerContext } from './rule-handler.interface';

function makeRule(overrides: Partial<OptimizerRule> = {}): OptimizerRule {
  return {
    id: 'rule-bidlimit-1',
    orgId: null,
    ruleFamily: 'BID_LIMIT' as RuleFamily,
    name: 'Lower ceiling when CPC trends high',
    description: null,
    isEnabled: true,
    priority: 80,
    kpiMetric: 'cpc',
    comparator: 'GT' as RuleComparator,
    thresholdValue: 2 as unknown as OptimizerRule['thresholdValue'],
    consecutiveWindows: 1,
    actionType: ActionType.ADJUST_BID_CEILING,
    actionDelta: null,
    actionTargetValue: '1.50',
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
    metrics: { cpc: 3.2, impressions24h: 5000 },
    currentBaseline: null,
    ...overrides,
  };
}

describe('BidLimitRuleHandler', () => {
  const handler = new BidLimitRuleHandler();

  it('proposes an ADJUST_BID_CEILING action with target value', () => {
    const result = handler.evaluate(makeRule(), makeCtx());

    expect(result.kind).toBe('proposed');
    if (result.kind !== 'proposed') return;
    expect(result.action.actionType).toBe(ActionType.ADJUST_BID_CEILING);
    expect(result.action.targetValue).toBe('1.50');
    expect(result.action.currentValue).toBeNull();
    expect(result.action.proposedValue).toBeNull();
    expect(result.action.explanation.en).toContain('1.50');
  });

  it('handles ADJUST_BID_FLOOR with the same shape', () => {
    const rule = makeRule({
      actionType: ActionType.ADJUST_BID_FLOOR,
      kpiMetric: 'cpc',
      comparator: 'LT' as RuleComparator,
      thresholdValue: 0.5 as unknown as OptimizerRule['thresholdValue'],
      actionTargetValue: '0.30',
    });
    const ctx = makeCtx({ metrics: { cpc: 0.2, impressions24h: 5000 } });

    const result = handler.evaluate(rule, ctx);

    expect(result.kind).toBe('proposed');
    if (result.kind !== 'proposed') return;
    expect(result.action.actionType).toBe(ActionType.ADJUST_BID_FLOOR);
    expect(result.action.targetValue).toBe('0.30');
  });

  it('skips with KPI_MISSING when KPI value is undefined', () => {
    const ctx = makeCtx({ metrics: { impressions24h: 5000 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('KPI_MISSING');
  });

  it('skips with THRESHOLD_NOT_MET when comparator does not match', () => {
    const ctx = makeCtx({ metrics: { cpc: 1.0, impressions24h: 5000 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('THRESHOLD_NOT_MET');
  });

  it('declares both ADJUST_BID_CEILING and ADJUST_BID_FLOOR as supported', () => {
    expect(handler.supports.has(ActionType.ADJUST_BID_CEILING)).toBe(true);
    expect(handler.supports.has(ActionType.ADJUST_BID_FLOOR)).toBe(true);
    expect(handler.supports.has(ActionType.SWITCH_BIDDING_STRATEGY)).toBe(false);
  });
});
