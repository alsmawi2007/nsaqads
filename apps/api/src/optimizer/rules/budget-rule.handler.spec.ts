import { ActionType, OptimizerRule, RuleComparator, PlatformScope, PhaseScope, RuleFamily } from '@prisma/client';
import { BudgetRuleHandler } from './budget-rule.handler';
import { RuleHandlerContext } from './rule-handler.interface';

function makeRule(overrides: Partial<OptimizerRule> = {}): OptimizerRule {
  return {
    id: 'rule-1',
    orgId: null,
    ruleFamily: 'BUDGET' as RuleFamily,
    name: 'High ROAS budget boost',
    description: null,
    isEnabled: true,
    priority: 100,
    kpiMetric: 'roas',
    comparator: 'GTE' as RuleComparator,
    thresholdValue: 3 as unknown as OptimizerRule['thresholdValue'],
    consecutiveWindows: 1,
    actionType: ActionType.INCREASE_BUDGET,
    actionDelta: 15 as unknown as OptimizerRule['actionDelta'],
    actionTargetValue: null,
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
    entityType: 'CAMPAIGN',
    entityId: 'camp-1',
    platform: 'META',
    adAccountId: 'acc-1',
    adAccountCurrency: 'SAR',
    metrics: { roas: 4.2, cpa: null, cpc: null, ctr: null, spendPacing: null, impressions24h: 5000 },
    currentBaseline: 500,
    ...overrides,
  };
}

describe('BudgetRuleHandler', () => {
  const handler = new BudgetRuleHandler();

  it('proposes an INCREASE_BUDGET action when ROAS exceeds threshold', () => {
    const result = handler.evaluate(makeRule(), makeCtx());

    expect(result.kind).toBe('proposed');
    if (result.kind !== 'proposed') return;
    expect(result.action.actionType).toBe(ActionType.INCREASE_BUDGET);
    expect(result.action.currentValue).toBe(500);
    expect(result.action.proposedValue).toBe(575); // 500 * 1.15
    expect(result.action.deltaPct).toBe(15);
    expect(result.action.explanation.en).toContain('triggered');
    expect(result.action.explanation.en).toContain('575');
  });

  it('skips with KPI_MISSING when the rule\'s KPI is null', () => {
    const ctx = makeCtx({ metrics: { roas: null, impressions24h: 5000 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('KPI_MISSING');
  });

  it('skips with INSUFFICIENT_SAMPLE when impressions are below minSampleImpressions', () => {
    const ctx = makeCtx({ metrics: { roas: 4.2, impressions24h: 100 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('INSUFFICIENT_SAMPLE');
  });

  it('skips with THRESHOLD_NOT_MET when comparator does not match', () => {
    const ctx = makeCtx({ metrics: { roas: 1.5, impressions24h: 5000 } });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('THRESHOLD_NOT_MET');
  });

  it('skips with MISSING_BASELINE when currentBaseline is null (e.g. ad-set rules)', () => {
    const ctx = makeCtx({ entityType: 'AD_SET', entityId: 'as-1', currentBaseline: null });
    const result = handler.evaluate(makeRule(), ctx);

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('MISSING_BASELINE');
  });

  it('skips with MISSING_BASELINE when actionDelta is null', () => {
    const result = handler.evaluate(makeRule({ actionDelta: null }), makeCtx());

    expect(result.kind).toBe('skipped');
    if (result.kind !== 'skipped') return;
    expect(result.reason.code).toBe('MISSING_BASELINE');
  });

  it('handles DECREASE_BUDGET via the same path with negative delta', () => {
    const rule = makeRule({
      actionType: ActionType.DECREASE_BUDGET,
      kpiMetric: 'cpa',
      comparator: 'GT' as RuleComparator,
      thresholdValue: 50 as unknown as OptimizerRule['thresholdValue'],
      actionDelta: -20 as unknown as OptimizerRule['actionDelta'],
    });
    const ctx = makeCtx({
      metrics: { cpa: 80, roas: null, impressions24h: 5000 },
    });

    const result = handler.evaluate(rule, ctx);

    expect(result.kind).toBe('proposed');
    if (result.kind !== 'proposed') return;
    expect(result.action.actionType).toBe(ActionType.DECREASE_BUDGET);
    expect(result.action.proposedValue).toBe(400); // 500 * 0.80
  });

  it('declares its supported action types', () => {
    expect(handler.supports.has(ActionType.INCREASE_BUDGET)).toBe(true);
    expect(handler.supports.has(ActionType.DECREASE_BUDGET)).toBe(true);
    expect(handler.supports.has(ActionType.SWITCH_BIDDING_STRATEGY)).toBe(false);
  });
});
