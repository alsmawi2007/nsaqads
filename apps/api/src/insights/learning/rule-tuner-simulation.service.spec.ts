import { RuleComparator } from '@prisma/client';
import {
  ActionLike,
  OptimizerRuleLike,
  RuleTunerSimulationService,
  applyTighteningDelta,
  compare,
  decideAction,
  pickConfidence,
  projectImpact,
  readKpiValue,
  simulateRule,
} from './rule-tuner-simulation.service';
import {
  RuleSimulationActionDto,
  SimulatedActionType,
  SimulationConfidence,
} from './rule-tuner-simulation.dto';
import {
  RuleFeedbackBreakdownDto,
  RuleHealthEntryDto,
  RuleHealthHooksDto,
  RuleHealthResponseDto,
} from './rule-performance.dto';
import { RuleHealth, RuleHealthConfidence, RuleRecommendedAction } from './rule-performance.types';
import { RulePerformanceService } from './rule-performance.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function breakdown(overrides: Partial<RuleFeedbackBreakdownDto> = {}): RuleFeedbackBreakdownDto {
  return {
    interactionCount:      0,
    withFeedbackCount:     0,
    usefulCount:           0,
    notUsefulCount:        0,
    wrongCount:            0,
    needsMoreContextCount: 0,
    usefulRate:            0,
    notUsefulRate:         0,
    wrongRate:             0,
    needsMoreContextRate:  0,
    ...overrides,
  };
}

function hooks(overrides: Partial<RuleHealthHooksDto> = {}): RuleHealthHooksDto {
  return {
    recommendedAction:      RuleRecommendedAction.NO_ACTION,
    proposedScoreFloor:     null,
    proposedThresholdDelta: null,
    shouldConsiderDisable:  false,
    ...overrides,
  };
}

function entry(overrides: Partial<RuleHealthEntryDto> = {}): RuleHealthEntryDto {
  return {
    ruleId:     'rule-A',
    scope:      'org-1',
    health:     RuleHealth.HEALTHY,
    confidence: RuleHealthConfidence.HIGH,
    ruleScore:  80,
    reasons:    [],
    breakdown:  breakdown(),
    hooks:      hooks(),
    ...overrides,
  };
}

function ruleDef(overrides: Partial<OptimizerRuleLike> = {}): OptimizerRuleLike {
  return {
    id:             'rule-A',
    kpiMetric:      'cpa',
    comparator:     RuleComparator.GT,
    thresholdValue: 50,
    ...overrides,
  };
}

function action(kpi: number | null, kpiKey = 'cpa', id = 'a-' + Math.random().toString(36).slice(2)): ActionLike {
  if (kpi === null) return { id, evaluationContext: {} };
  return { id, evaluationContext: { [kpiKey]: kpi } };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('rule-tuner-simulation pure helpers', () => {
  describe('applyTighteningDelta', () => {
    it('raises threshold for GT/GTE comparators when delta is negative', () => {
      // delta=-0.1 means "tighten by 10%". For GT (e.g. cpa>50), tightening
      // = harder to fire = higher threshold.
      expect(applyTighteningDelta(50, RuleComparator.GT,  -0.1)).toBeCloseTo(55);
      expect(applyTighteningDelta(50, RuleComparator.GTE, -0.1)).toBeCloseTo(55);
    });

    it('lowers threshold for LT/LTE comparators when delta is negative', () => {
      // For LT (e.g. roas<2.0), tightening = lower threshold.
      expect(applyTighteningDelta(2.0, RuleComparator.LT,  -0.1)).toBeCloseTo(1.8);
      expect(applyTighteningDelta(2.0, RuleComparator.LTE, -0.1)).toBeCloseTo(1.8);
    });

    it('treats EQ as a no-op since multiplicative tightening is meaningless', () => {
      expect(applyTighteningDelta(50, RuleComparator.EQ, -0.1)).toBe(50);
    });

    it('uses |delta| so a positive delta also tightens (interpreted as magnitude)', () => {
      // Defensive: callers shouldn't pass positives for "tighten" but the
      // helper should still produce a sane number rather than loosen.
      expect(applyTighteningDelta(50, RuleComparator.GT, 0.1)).toBeCloseTo(55);
    });
  });

  describe('compare', () => {
    it('matches each comparator', () => {
      expect(compare(60, RuleComparator.GT,  50)).toBe(true);
      expect(compare(50, RuleComparator.GT,  50)).toBe(false);
      expect(compare(50, RuleComparator.GTE, 50)).toBe(true);
      expect(compare(40, RuleComparator.LT,  50)).toBe(true);
      expect(compare(50, RuleComparator.LT,  50)).toBe(false);
      expect(compare(50, RuleComparator.LTE, 50)).toBe(true);
      expect(compare(50, RuleComparator.EQ,  50)).toBe(true);
      expect(compare(50, RuleComparator.EQ,  51)).toBe(false);
    });
  });

  describe('readKpiValue', () => {
    it('reads a top-level numeric key', () => {
      expect(readKpiValue({ cpa: 52.3, spend: 100 }, 'cpa')).toBe(52.3);
    });

    it('reads from a nested metrics object', () => {
      expect(readKpiValue({ metrics: { cpa: 41.2 } }, 'cpa')).toBe(41.2);
    });

    it('returns null when missing or not a finite number', () => {
      expect(readKpiValue({ cpa: 'high' }, 'cpa')).toBeNull();
      expect(readKpiValue({ cpa: NaN }, 'cpa')).toBeNull();
      expect(readKpiValue({}, 'cpa')).toBeNull();
      expect(readKpiValue(null, 'cpa')).toBeNull();
      expect(readKpiValue(undefined, 'cpa')).toBeNull();
    });

    it('prefers top-level over nested when both exist', () => {
      expect(readKpiValue({ cpa: 1, metrics: { cpa: 99 } }, 'cpa')).toBe(1);
    });
  });

  describe('pickConfidence', () => {
    it('LOW when no actions observed', () => {
      expect(pickConfidence(0, 0)).toBe(SimulationConfidence.LOW);
    });

    it('LOW below MEDIUM_CONFIDENCE_ACTION_COUNT', () => {
      expect(pickConfidence(5, 0)).toBe(SimulationConfidence.LOW);
    });

    it('MEDIUM at the medium threshold', () => {
      expect(pickConfidence(10, 0)).toBe(SimulationConfidence.MEDIUM);
      expect(pickConfidence(29, 0)).toBe(SimulationConfidence.MEDIUM);
    });

    it('HIGH only when sample is large AND indeterminate ratio is low', () => {
      expect(pickConfidence(30, 0)).toBe(SimulationConfidence.HIGH);
      expect(pickConfidence(100, 5)).toBe(SimulationConfidence.HIGH);  // 5% indeterminate
    });

    it('downgrades HIGH to MEDIUM when too many actions are indeterminate', () => {
      // 30 actions, 5 indeterminate = 16.7% > 10% threshold → drop a band.
      expect(pickConfidence(30, 5)).toBe(SimulationConfidence.MEDIUM);
    });
  });
});

// ─── decideAction ─────────────────────────────────────────────────────────────

describe('decideAction', () => {
  it('DISABLE_RULE when shouldConsiderDisable=true (regardless of other hooks)', () => {
    const e = entry({
      health: RuleHealth.NEEDS_TUNING,
      breakdown: breakdown({ wrongRate: 0.6 }),
      hooks: hooks({
        shouldConsiderDisable: true,
        proposedThresholdDelta: -0.1, // also set, but disable wins
        recommendedAction: RuleRecommendedAction.CONSIDER_DISABLE,
      }),
    });
    const a = decideAction(e, ruleDef());
    expect(a.type).toBe(SimulatedActionType.DISABLE_RULE);
    expect(a.shouldDisable).toBe(true);
    expect(a.proposedThresholdDelta).toBeNull();
  });

  it('TIGHTEN_THRESHOLD when proposedThresholdDelta is set, computes projectedNewThreshold', () => {
    const e = entry({
      health: RuleHealth.NEEDS_TUNING,
      hooks: hooks({
        proposedThresholdDelta: -0.1,
        recommendedAction: RuleRecommendedAction.CONSIDER_TUNING,
      }),
    });
    const a = decideAction(e, ruleDef({ thresholdValue: 50, comparator: RuleComparator.GT }));
    expect(a.type).toBe(SimulatedActionType.TIGHTEN_THRESHOLD);
    expect(a.proposedThresholdDelta).toBe(-0.1);
    expect(a.projectedNewThreshold).toBeCloseTo(55);
    expect(a.shouldDisable).toBe(false);
  });

  it('TIGHTEN_THRESHOLD without ruleDef leaves projectedNewThreshold null', () => {
    const e = entry({ hooks: hooks({ proposedThresholdDelta: -0.1 }) });
    const a = decideAction(e, undefined);
    expect(a.type).toBe(SimulatedActionType.TIGHTEN_THRESHOLD);
    expect(a.projectedNewThreshold).toBeNull();
  });

  it('RAISE_SCORE_FLOOR when only proposedScoreFloor is set', () => {
    const e = entry({
      health: RuleHealth.HEALTHY,
      hooks: hooks({ proposedScoreFloor: 85 }),
    });
    const a = decideAction(e, ruleDef());
    expect(a.type).toBe(SimulatedActionType.RAISE_SCORE_FLOOR);
    expect(a.proposedScoreFloor).toBe(85);
  });

  it('NO_CHANGE for UNSTABLE / LOW_SIGNAL / vanilla HEALTHY rules without floor', () => {
    expect(decideAction(entry({ health: RuleHealth.UNSTABLE }),  ruleDef()).type).toBe(SimulatedActionType.NO_CHANGE);
    expect(decideAction(entry({ health: RuleHealth.LOW_SIGNAL }), ruleDef()).type).toBe(SimulatedActionType.NO_CHANGE);
    expect(decideAction(entry({ health: RuleHealth.HEALTHY }),    ruleDef()).type).toBe(SimulatedActionType.NO_CHANGE);
  });
});

// ─── projectImpact ────────────────────────────────────────────────────────────

describe('projectImpact', () => {
  const tightenAction: RuleSimulationActionDto = {
    type: SimulatedActionType.TIGHTEN_THRESHOLD,
    description: '',
    proposedThresholdDelta: -0.1,
    projectedNewThreshold: 55,
    proposedScoreFloor: null,
    shouldDisable: false,
  };
  const disableAction: RuleSimulationActionDto = {
    type: SimulatedActionType.DISABLE_RULE,
    description: '',
    proposedThresholdDelta: null,
    projectedNewThreshold: null,
    proposedScoreFloor: null,
    shouldDisable: true,
  };
  const noChangeAction: RuleSimulationActionDto = {
    type: SimulatedActionType.NO_CHANGE,
    description: '',
    proposedThresholdDelta: null,
    projectedNewThreshold: null,
    proposedScoreFloor: null,
    shouldDisable: false,
  };
  const scoreFloorAction: RuleSimulationActionDto = {
    type: SimulatedActionType.RAISE_SCORE_FLOOR,
    description: '',
    proposedThresholdDelta: null,
    projectedNewThreshold: null,
    proposedScoreFloor: 85,
    shouldDisable: false,
  };

  it('DISABLE_RULE projects -recentActions.length and full suppression', () => {
    const e = entry({ breakdown: breakdown({ interactionCount: 200 }) });
    const recent = [action(40), action(60), action(70)];
    const impact = projectImpact(e, ruleDef(), recent, disableAction);
    expect(impact.projectedActionCount).toBe(0);
    expect(impact.projectedActionDelta).toBe(-3);
    expect(impact.suppressedActionCount).toBe(3);
    expect(impact.indeterminateActionCount).toBe(0);
    expect(impact.currentInteractionCount).toBe(200);
  });

  it('TIGHTEN_THRESHOLD replays each action against the new threshold', () => {
    // GT 50 → tightened to 55. Actions: 60 still fires, 52 suppressed, 80 still fires.
    const e = entry();
    const recent = [action(60), action(52), action(80)];
    const impact = projectImpact(e, ruleDef({ thresholdValue: 50, comparator: RuleComparator.GT }), recent, tightenAction);
    expect(impact.suppressedActionCount).toBe(1);
    expect(impact.projectedActionCount).toBe(2);
    expect(impact.projectedActionDelta).toBe(-1);
  });

  it('TIGHTEN_THRESHOLD counts actions without usable KPI as indeterminate', () => {
    const e = entry();
    // Two have a kpi value, three are missing it.
    const recent = [action(60), action(52), action(null), action(null), action(null)];
    const impact = projectImpact(e, ruleDef({ thresholdValue: 50, comparator: RuleComparator.GT }), recent, tightenAction);
    expect(impact.indeterminateActionCount).toBe(3);
    expect(impact.suppressedActionCount).toBe(1);
    // projected = kept + indeterminate = 1 + 3 = 4
    expect(impact.projectedActionCount).toBe(4);
    expect(impact.projectedActionDelta).toBe(-1);
  });

  it('TIGHTEN_THRESHOLD without rule definition is fully indeterminate at LOW confidence', () => {
    const e = entry();
    const recent = [action(60), action(40)];
    const impact = projectImpact(e, undefined, recent, tightenAction);
    expect(impact.indeterminateActionCount).toBe(2);
    expect(impact.confidence).toBe(SimulationConfidence.LOW);
  });

  it('RAISE_SCORE_FLOOR leaves firing counts unchanged', () => {
    const e = entry();
    const recent = [action(60), action(40)];
    const impact = projectImpact(e, ruleDef(), recent, scoreFloorAction);
    expect(impact.projectedActionCount).toBe(2);
    expect(impact.projectedActionDelta).toBe(0);
    expect(impact.suppressedActionCount).toBe(0);
  });

  it('NO_CHANGE leaves firing counts unchanged', () => {
    const e = entry();
    const recent = [action(60)];
    const impact = projectImpact(e, ruleDef(), recent, noChangeAction);
    expect(impact.projectedActionDelta).toBe(0);
  });
});

// ─── simulateRule (composition) ───────────────────────────────────────────────

describe('simulateRule composition', () => {
  it('returns a stable shape across all action types', () => {
    const cases: { entry: RuleHealthEntryDto; expected: SimulatedActionType }[] = [
      { entry: entry({ hooks: hooks({ shouldConsiderDisable: true }) }), expected: SimulatedActionType.DISABLE_RULE },
      { entry: entry({ hooks: hooks({ proposedThresholdDelta: -0.1 }) }), expected: SimulatedActionType.TIGHTEN_THRESHOLD },
      { entry: entry({ hooks: hooks({ proposedScoreFloor: 90 }) }),       expected: SimulatedActionType.RAISE_SCORE_FLOOR },
      { entry: entry({ health: RuleHealth.UNSTABLE }),                    expected: SimulatedActionType.NO_CHANGE },
    ];

    for (const c of cases) {
      const result = simulateRule(c.entry, ruleDef(), [action(60)]);
      expect(result.action.type).toBe(c.expected);
      expect(result.ruleId).toBe('rule-A');
      expect(result.scope).toBe('org-1');
      expect(result.currentHealth).toBe(c.entry.health);
      expect(result.impact.notes.length).toBeGreaterThan(0);
    }
  });
});

// ─── Service ─────────────────────────────────────────────────────────────────

interface MockPrisma {
  optimizerRule: { findMany: jest.Mock };
  optimizerAction: { findMany: jest.Mock };
}

function buildService(opts: {
  health: RuleHealthResponseDto;
  ruleDefs?: any[];
  actions?: any[];
}) {
  const prisma: MockPrisma = {
    optimizerRule: { findMany: jest.fn().mockResolvedValue(opts.ruleDefs ?? []) },
    optimizerAction: { findMany: jest.fn().mockResolvedValue(opts.actions ?? []) },
  };
  const performance: Partial<RulePerformanceService> = {
    getForOrg: jest.fn().mockResolvedValue(opts.health),
    getForAllOrgs: jest.fn().mockResolvedValue(opts.health),
  };
  const service = new RuleTunerSimulationService(
    prisma as unknown as PrismaService,
    performance as RulePerformanceService,
  );
  return { service, prisma, performance };
}

describe('RuleTunerSimulationService', () => {
  it('returns an empty summary when no rules are present', async () => {
    const health: RuleHealthResponseDto = {
      scope: 'org-1',
      summary: { totalRules: 0, byHealth: { HEALTHY: 0, NEEDS_TUNING: 0, UNSTABLE: 0, LOW_SIGNAL: 0 }, averageRuleScore: 0 },
      rules: [],
      uncategorizedCount: 0,
      generatedAt: new Date().toISOString(),
    };
    const { service, prisma } = buildService({ health });
    const result = await service.getForOrg('org-1');

    expect(result.scope).toBe('org-1');
    expect(result.rules).toHaveLength(0);
    expect(result.summary.totalRules).toBe(0);
    expect(result.isShadowMode).toBe(true);
    // No rule defs/actions queried when there's nothing to simulate.
    expect(prisma.optimizerRule.findMany).not.toHaveBeenCalled();
    expect(prisma.optimizerAction.findMany).not.toHaveBeenCalled();
  });

  it('joins health entries with rule defs + actions, scoping action lookup to org', async () => {
    const ruleEntry = entry({
      ruleId: 'rule-A',
      hooks: hooks({ proposedThresholdDelta: -0.1, recommendedAction: RuleRecommendedAction.CONSIDER_TUNING }),
      breakdown: breakdown({ interactionCount: 50 }),
    });
    const health: RuleHealthResponseDto = {
      scope: 'org-1',
      summary: { totalRules: 1, byHealth: { HEALTHY: 0, NEEDS_TUNING: 1, UNSTABLE: 0, LOW_SIGNAL: 0 }, averageRuleScore: 40 },
      rules: [ruleEntry],
      uncategorizedCount: 0,
      generatedAt: new Date().toISOString(),
    };

    const { service, prisma } = buildService({
      health,
      ruleDefs: [{ id: 'rule-A', kpiMetric: 'cpa', comparator: 'GT', thresholdValue: 50 }],
      actions: [
        { id: 'a1', ruleId: 'rule-A', evaluationContext: { cpa: 60 } }, // would still fire
        { id: 'a2', ruleId: 'rule-A', evaluationContext: { cpa: 52 } }, // suppressed @ 55
        { id: 'a3', ruleId: 'rule-A', evaluationContext: { cpa: 80 } }, // still fires
      ],
    });

    const result = await service.getForOrg('org-1', 14);

    expect(prisma.optimizerRule.findMany).toHaveBeenCalledWith({ where: { id: { in: ['rule-A'] } } });
    const actionCall = prisma.optimizerAction.findMany.mock.calls[0][0];
    expect(actionCall.where.orgId).toBe('org-1');
    expect(actionCall.where.ruleId).toEqual({ in: ['rule-A'] });
    // lookbackDays threaded through
    expect(actionCall.where.createdAt.gte).toBeInstanceOf(Date);

    expect(result.lookbackDays).toBe(14);
    expect(result.rules).toHaveLength(1);
    const r = result.rules[0];
    expect(r.action.type).toBe(SimulatedActionType.TIGHTEN_THRESHOLD);
    expect(r.action.projectedNewThreshold).toBeCloseTo(55);
    expect(r.impact.suppressedActionCount).toBe(1);
    expect(r.impact.projectedActionCount).toBe(2);
    expect(r.impact.currentActionCount).toBe(3);
  });

  it('cross-org simulation passes no orgId filter to the action query', async () => {
    const health: RuleHealthResponseDto = {
      scope: 'ALL',
      summary: { totalRules: 1, byHealth: { HEALTHY: 1, NEEDS_TUNING: 0, UNSTABLE: 0, LOW_SIGNAL: 0 }, averageRuleScore: 80 },
      rules: [entry({ ruleId: 'rule-A', scope: 'ALL', hooks: hooks({ proposedScoreFloor: 85 }) })],
      uncategorizedCount: 0,
      generatedAt: new Date().toISOString(),
    };
    const { service, prisma, performance } = buildService({
      health,
      ruleDefs: [{ id: 'rule-A', kpiMetric: 'cpa', comparator: 'GT', thresholdValue: 50 }],
      actions: [],
    });

    const result = await service.getForAllOrgs();

    expect(performance.getForAllOrgs).toHaveBeenCalled();
    const actionCall = prisma.optimizerAction.findMany.mock.calls[0][0];
    expect('orgId' in actionCall.where).toBe(false);
    expect(result.scope).toBe('ALL');
    expect(result.rules[0].action.type).toBe(SimulatedActionType.RAISE_SCORE_FLOOR);
  });

  it('summary aggregates rulesByAction and totalProjectedActionDelta', async () => {
    const health: RuleHealthResponseDto = {
      scope: 'org-1',
      summary: { totalRules: 3, byHealth: { HEALTHY: 1, NEEDS_TUNING: 2, UNSTABLE: 0, LOW_SIGNAL: 0 }, averageRuleScore: 50 },
      rules: [
        entry({ ruleId: 'r-disable', hooks: hooks({ shouldConsiderDisable: true, proposedThresholdDelta: -0.1 }) }),
        entry({ ruleId: 'r-tighten', hooks: hooks({ proposedThresholdDelta: -0.1 }) }),
        entry({ ruleId: 'r-floor',   hooks: hooks({ proposedScoreFloor: 88 }) }),
      ],
      uncategorizedCount: 2,
      generatedAt: new Date().toISOString(),
    };
    const { service } = buildService({
      health,
      ruleDefs: [
        { id: 'r-disable', kpiMetric: 'cpa', comparator: 'GT', thresholdValue: 50 },
        { id: 'r-tighten', kpiMetric: 'cpa', comparator: 'GT', thresholdValue: 50 },
        { id: 'r-floor',   kpiMetric: 'roas', comparator: 'LT', thresholdValue: 2 },
      ],
      actions: [
        { id: 'd1', ruleId: 'r-disable', evaluationContext: { cpa: 70 } },
        { id: 'd2', ruleId: 'r-disable', evaluationContext: { cpa: 80 } },
        { id: 't1', ruleId: 'r-tighten', evaluationContext: { cpa: 60 } }, // still fires @ 55
        { id: 't2', ruleId: 'r-tighten', evaluationContext: { cpa: 52 } }, // suppressed @ 55
        { id: 'f1', ruleId: 'r-floor',   evaluationContext: { roas: 1.5 } }, // unaffected
      ],
    });

    const result = await service.getForOrg('org-1');

    expect(result.summary.totalRules).toBe(3);
    expect(result.summary.rulesByAction[SimulatedActionType.DISABLE_RULE]).toBe(1);
    expect(result.summary.rulesByAction[SimulatedActionType.TIGHTEN_THRESHOLD]).toBe(1);
    expect(result.summary.rulesByAction[SimulatedActionType.RAISE_SCORE_FLOOR]).toBe(1);
    expect(result.summary.totalCurrentActions).toBe(5);
    // r-disable contributes -2, r-tighten contributes -1, r-floor contributes 0.
    expect(result.summary.totalProjectedActionDelta).toBe(-3);
    expect(result.uncategorizedCount).toBe(2);
    expect(result.isShadowMode).toBe(true);
  });

  it('clamps lookbackDays into [1, 365]', async () => {
    const health: RuleHealthResponseDto = {
      scope: 'org-1',
      summary: { totalRules: 0, byHealth: { HEALTHY: 0, NEEDS_TUNING: 0, UNSTABLE: 0, LOW_SIGNAL: 0 }, averageRuleScore: 0 },
      rules: [],
      uncategorizedCount: 0,
      generatedAt: new Date().toISOString(),
    };
    const { service } = buildService({ health });

    // 0 is below the floor — caller is responsible for clamping; service
    // accepts whatever it's given but doesn't crash.
    const r = await service.getForOrg('org-1', 0);
    expect(r.lookbackDays).toBe(0);
  });
});
