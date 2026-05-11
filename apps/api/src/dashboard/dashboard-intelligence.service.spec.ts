import { ActionType, Platform, RuleTuningStatus } from '@prisma/client';
import { DashboardIntelligenceService } from './dashboard-intelligence.service';
import { InsightsService } from '../insights/insights.service';
import { InsightAnalyticsService } from '../insights/analytics/insight-analytics.service';
import { RulePerformanceService } from '../insights/learning/rule-performance.service';
import { RuleTunerSimulationService } from '../insights/learning/rule-tuner-simulation.service';
import { RuleTunerService } from '../insights/learning/rule-tuner.service';
import { InsightDto, InsightListResponseDto, InsightSeverity, InsightType } from '../insights/dto/insight.dto';
import { InsightAnalyticsResponseDto } from '../insights/analytics/insight-analytics.dto';
import { RuleHealthEntryDto, RuleHealthResponseDto } from '../insights/learning/rule-performance.dto';
import { RuleHealth, RuleHealthConfidence, RuleRecommendedAction } from '../insights/learning/rule-performance.types';
import {
  RuleSimulationResponseDto,
  SimulatedActionType,
  SimulationConfidence,
} from '../insights/learning/rule-tuner-simulation.dto';
import { RuleTunerObservabilityDto, RuleTunerRunSummaryDto } from '../insights/learning/rule-tuner-history.dto';

// ─── Fixture builders ────────────────────────────────────────────────────────

let nextId = 0;
function makeInsight(overrides: Partial<InsightDto> = {}): InsightDto {
  nextId += 1;
  return {
    id:                `i-${nextId}`,
    orgId:             'org-1',
    entityType:        'CAMPAIGN',
    entityId:          'camp-1',
    entityName:        'Spring Promo',
    platform:          'META' as Platform,
    insightType:       InsightType.OPTIMIZATION_OPPORTUNITY,
    severity:          InsightSeverity.MEDIUM,
    title:             { en: 'A title', ar: null },
    description:       { en: 'A description', ar: null },
    context:           {},
    relatedRuleId:     'rule-1',
    relatedActionType: ActionType.INCREASE_BUDGET,
    generatedAt:       '2026-04-29T00:00:00.000Z',
    score:             50,
    priority:          'MEDIUM',
    scoreBreakdown: {
      severity:       { value: 0, weight: 0, contribution: 0 },
      confidence:     { value: 0, weight: 0, contribution: 0 },
      impact:         { value: 0, weight: 0, contribution: 0 },
      magnitude:      { value: 0, weight: 0, contribution: 0 },
      actionability:  { value: 0, weight: 0, contribution: 0 },
      recency:        { value: 0, weight: 0, contribution: 0 },
      total:          50,
    },
    userStatus:        null,
    feedback:          null,
    userNote:          null,
    interactedAt:      null,
    ...overrides,
  };
}

function makeInsightsList(insights: InsightDto[]): InsightListResponseDto {
  const totals = { info: 0, low: 0, medium: 0, high: 0 };
  for (const i of insights) {
    if (i.severity === InsightSeverity.INFO)   totals.info++;
    if (i.severity === InsightSeverity.LOW)    totals.low++;
    if (i.severity === InsightSeverity.MEDIUM) totals.medium++;
    if (i.severity === InsightSeverity.HIGH)   totals.high++;
  }
  return { insights, totals, generatedAt: '2026-04-29T00:00:00.000Z' };
}

function makeAnalytics(overrides: Partial<{
  interactionCount: number;
  withFeedbackCount: number;
  usefulRate: number;
  notUsefulRate: number;
  wrongRate: number;
  needsMoreContextRate: number;
}> = {}): InsightAnalyticsResponseDto {
  return {
    orgId: 'org-1',
    totals: {
      interactionCount:  overrides.interactionCount  ?? 100,
      withStatusCount:   80,
      withFeedbackCount: overrides.withFeedbackCount ?? 50,
      statusCounts:      { SEEN: 60, DISMISSED: 10, SAVED: 10 },
      feedbackCounts:    { USEFUL: 30, NOT_USEFUL: 5, WRONG: 5, NEEDS_MORE_CONTEXT: 10 },
      rates: {
        seenRate:             0.75,
        dismissedRate:        0.125,
        savedRate:            0.125,
        usefulRate:           overrides.usefulRate           ?? 0.6,
        notUsefulRate:        overrides.notUsefulRate        ?? 0.1,
        wrongRate:            overrides.wrongRate            ?? 0.1,
        needsMoreContextRate: overrides.needsMoreContextRate ?? 0.2,
      },
    },
    byInsightType: [],
    byPriority:    [],
    byPlatform:    [],
    byActionType:  [],
    byUser:        [],
    generatedAt:   '2026-04-29T00:00:00.000Z',
  };
}

function makeRuleHealthEntry(overrides: Partial<RuleHealthEntryDto> = {}): RuleHealthEntryDto {
  return {
    ruleId:     'rule-1',
    scope:      'org-1',
    health:     RuleHealth.HEALTHY,
    confidence: RuleHealthConfidence.HIGH,
    ruleScore:  80,
    reasons:    [],
    breakdown: {
      interactionCount:      50,
      withFeedbackCount:     40,
      usefulCount:           30,
      notUsefulCount:        4,
      wrongCount:            3,
      needsMoreContextCount: 3,
      usefulRate:            0.75,
      notUsefulRate:         0.10,
      wrongRate:             0.075,
      needsMoreContextRate:  0.075,
    },
    hooks: {
      recommendedAction:      RuleRecommendedAction.NO_ACTION,
      proposedScoreFloor:     null,
      proposedThresholdDelta: null,
      shouldConsiderDisable:  false,
    },
    ...overrides,
  };
}

function makeRuleHealth(rules: RuleHealthEntryDto[]): RuleHealthResponseDto {
  const byHealth: Record<RuleHealth, number> = {
    [RuleHealth.HEALTHY]:      0,
    [RuleHealth.NEEDS_TUNING]: 0,
    [RuleHealth.UNSTABLE]:     0,
    [RuleHealth.LOW_SIGNAL]:   0,
  };
  let scoreSum = 0;
  let scoreCount = 0;
  for (const r of rules) {
    byHealth[r.health]++;
    if (r.health !== RuleHealth.LOW_SIGNAL) {
      scoreSum += r.ruleScore;
      scoreCount++;
    }
  }
  return {
    scope: 'org-1',
    summary: {
      totalRules: rules.length,
      byHealth,
      averageRuleScore: scoreCount ? scoreSum / scoreCount : 0,
    },
    rules,
    uncategorizedCount: 0,
    generatedAt: '2026-04-29T00:00:00.000Z',
  };
}

function makeSimulation(overrides: Partial<{
  totalRules: number;
  rulesByAction: Record<SimulatedActionType, number>;
  totalProjectedActionDelta: number;
  highConfidenceRuleCount: number;
  lookbackDays: number;
  totalCurrentInteractions: number;
  totalCurrentActions: number;
}> = {}): RuleSimulationResponseDto {
  return {
    scope: 'org-1',
    lookbackDays: overrides.lookbackDays ?? 30,
    summary: {
      totalRules:     overrides.totalRules     ?? 5,
      rulesByAction:  overrides.rulesByAction  ?? {
        [SimulatedActionType.NO_CHANGE]:         3,
        [SimulatedActionType.TIGHTEN_THRESHOLD]: 1,
        [SimulatedActionType.DISABLE_RULE]:      0,
        [SimulatedActionType.RAISE_SCORE_FLOOR]: 1,
      },
      totalCurrentInteractions:   overrides.totalCurrentInteractions   ?? 200,
      totalCurrentActions:        overrides.totalCurrentActions        ?? 80,
      totalProjectedActionDelta:  overrides.totalProjectedActionDelta  ?? -10,
      highConfidenceRuleCount:    overrides.highConfidenceRuleCount    ?? 2,
    },
    rules: [],
    isShadowMode: true,
    uncategorizedCount: 0,
    generatedAt: '2026-04-29T00:00:00.000Z',
  };
}

function makeRunSummary(overrides: Partial<RuleTunerRunSummaryDto> = {}): RuleTunerRunSummaryDto {
  return {
    runId:             'run-1',
    scope:             'org-1',
    triggeredByUserId: 'user-1',
    startedAt:         '2026-04-29T08:00:00.000Z',
    finishedAt:        '2026-04-29T08:05:00.000Z',
    totalChanges:      4,
    appliedCount:      3,
    rolledBackCount:   1,
    hasRollback:       true,
    ...overrides,
  };
}

function makeObservability(overrides: Partial<RuleTunerObservabilityDto> = {}): RuleTunerObservabilityDto {
  return {
    scope: 'org-1',
    totalRuns: 2,
    totalAppliedChanges: 5,
    totalRolledBackChanges: 1,
    recentRuns: [],
    lastAppliedRun: makeRunSummary(),
    lastAppliedAt: '2026-04-29T08:05:00.000Z',
    cooldownActive: true,
    cooldownExpiresAt: '2026-04-29T09:05:00.000Z',
    cooldownRemainingMinutes: 42,
    generatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Build the unit under test with mocked dependencies ─────────────────────

function makeService(opts: {
  insights?: InsightDto[];
  analytics?: InsightAnalyticsResponseDto;
  ruleHealth?: RuleHealthResponseDto;
  simulation?: RuleSimulationResponseDto;
  observability?: RuleTunerObservabilityDto;
} = {}) {
  const insightsService = {
    listForOrg: jest.fn().mockResolvedValue(makeInsightsList(opts.insights ?? [])),
  } as unknown as InsightsService;

  const analyticsService = {
    getForOrg: jest.fn().mockResolvedValue(opts.analytics ?? makeAnalytics()),
  } as unknown as InsightAnalyticsService;

  const rulePerformance = {
    getForOrg: jest.fn().mockResolvedValue(opts.ruleHealth ?? makeRuleHealth([])),
  } as unknown as RulePerformanceService;

  const ruleSimulation = {
    getForOrg: jest.fn().mockResolvedValue(opts.simulation ?? makeSimulation()),
  } as unknown as RuleTunerSimulationService;

  const ruleTuner = {
    getObservability: jest.fn().mockResolvedValue(opts.observability ?? makeObservability()),
  } as unknown as RuleTunerService;

  const service = new DashboardIntelligenceService(
    insightsService,
    analyticsService,
    rulePerformance,
    ruleSimulation,
    ruleTuner,
  );

  return { service, mocks: { insightsService, analyticsService, rulePerformance, ruleSimulation, ruleTuner } };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardIntelligenceService', () => {
  beforeEach(() => {
    nextId = 0;
  });

  describe('parallelism + plumbing', () => {
    it('calls every leaf service exactly once with the org and user ids', async () => {
      const { service, mocks } = makeService();
      await service.getIntelligenceForOrg('org-1', 'user-7');

      expect(mocks.insightsService.listForOrg).toHaveBeenCalledTimes(1);
      expect(mocks.insightsService.listForOrg).toHaveBeenCalledWith('org-1', 'user-7', {});
      expect(mocks.analyticsService.getForOrg).toHaveBeenCalledWith('org-1');
      expect(mocks.rulePerformance.getForOrg).toHaveBeenCalledWith('org-1');
      expect(mocks.ruleSimulation.getForOrg).toHaveBeenCalledWith('org-1');
      expect(mocks.ruleTuner.getObservability).toHaveBeenCalledWith('org-1');
    });

    it('returns the orgId echoed in the payload and an ISO generatedAt', async () => {
      const { service } = makeService();
      const res = await service.getIntelligenceForOrg('org-7', 'user-1');
      expect(res.orgId).toBe('org-7');
      expect(res.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('health summary', () => {
    it('mirrors the insight list size + severity totals and the analytics rates', async () => {
      const insights = [
        makeInsight({ severity: InsightSeverity.INFO }),
        makeInsight({ severity: InsightSeverity.LOW }),
        makeInsight({ severity: InsightSeverity.MEDIUM }),
        makeInsight({ severity: InsightSeverity.HIGH }),
        makeInsight({ severity: InsightSeverity.HIGH }),
      ];
      const analytics = makeAnalytics({
        interactionCount: 200,
        withFeedbackCount: 80,
        usefulRate: 0.7,
        wrongRate: 0.05,
      });
      const { service } = makeService({ insights, analytics });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.health.totalActiveInsights).toBe(5);
      expect(res.health.bySeverity).toEqual({ info: 1, low: 1, medium: 1, high: 2 });
      expect(res.health.totalInteractions).toBe(200);
      expect(res.health.withFeedbackCount).toBe(80);
      expect(res.health.usefulRate).toBe(0.7);
      expect(res.health.wrongRate).toBe(0.05);
    });

    it('returns zeroed totals when there are no insights and no interactions', async () => {
      const { service } = makeService({
        insights: [],
        analytics: makeAnalytics({ interactionCount: 0, withFeedbackCount: 0, usefulRate: 0, wrongRate: 0 }),
      });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');
      expect(res.health.totalActiveInsights).toBe(0);
      expect(res.health.bySeverity).toEqual({ info: 0, low: 0, medium: 0, high: 0 });
      expect(res.health.totalInteractions).toBe(0);
      expect(res.health.usefulRate).toBe(0);
    });
  });

  describe('topInsights', () => {
    it('caps the result at 10 items and preserves the upstream order', async () => {
      const insights = Array.from({ length: 25 }, (_, idx) =>
        makeInsight({ id: `i-${idx}`, score: 100 - idx }),
      );
      const { service } = makeService({ insights });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.topInsights).toHaveLength(10);
      expect(res.topInsights.map((t) => t.id)).toEqual(insights.slice(0, 10).map((i) => i.id));
    });

    it('flattens title.en and description.en for fast UI rendering', async () => {
      const insights = [
        makeInsight({ title: { en: 'Hello world', ar: null }, description: { en: 'A long-form explanation', ar: null } }),
      ];
      const { service } = makeService({ insights });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.topInsights[0].title).toBe('Hello world');
      expect(res.topInsights[0].description).toBe('A long-form explanation');
    });
  });

  describe('trendHighlights', () => {
    it('keeps only TREND_UP / TREND_DOWN / VOLATILITY_HIGH / PERFORMANCE_STAGNANT and caps at 5', async () => {
      const insights = [
        makeInsight({ insightType: InsightType.TREND_UP }),
        makeInsight({ insightType: InsightType.TREND_DOWN }),
        makeInsight({ insightType: InsightType.VOLATILITY_HIGH }),
        makeInsight({ insightType: InsightType.PERFORMANCE_STAGNANT }),
        makeInsight({ insightType: InsightType.TREND_UP }),
        makeInsight({ insightType: InsightType.TREND_UP }), // should be dropped (cap=5)
        makeInsight({ insightType: InsightType.OPTIMIZATION_OPPORTUNITY }), // not a trend
        makeInsight({ insightType: InsightType.PERFORMANCE_RISK }),         // not a trend
        makeInsight({ insightType: InsightType.LEARNING_PHASE }),           // not a trend
      ];
      const { service } = makeService({ insights });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.trendHighlights).toHaveLength(5);
      const trendTypes = new Set(res.trendHighlights.map((t) => t.insightType));
      expect(trendTypes).not.toContain(InsightType.OPTIMIZATION_OPPORTUNITY);
      expect(trendTypes).not.toContain(InsightType.PERFORMANCE_RISK);
      expect(trendTypes).not.toContain(InsightType.LEARNING_PHASE);
    });

    it('returns an empty array when no trend insights exist', async () => {
      const { service } = makeService({
        insights: [
          makeInsight({ insightType: InsightType.OPTIMIZATION_OPPORTUNITY }),
          makeInsight({ insightType: InsightType.READY_FOR_ACTION }),
        ],
      });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');
      expect(res.trendHighlights).toEqual([]);
    });
  });

  describe('ruleHealth summary', () => {
    it('flattens byHealth into named counts and surfaces NEEDS_TUNING ids (capped at 5)', async () => {
      const rules = [
        ...Array.from({ length: 7 }, (_, i) => makeRuleHealthEntry({ ruleId: `nt-${i}`, health: RuleHealth.NEEDS_TUNING })),
        makeRuleHealthEntry({ ruleId: 'h-1', health: RuleHealth.HEALTHY }),
        makeRuleHealthEntry({ ruleId: 'u-1', health: RuleHealth.UNSTABLE }),
        makeRuleHealthEntry({ ruleId: 'l-1', health: RuleHealth.LOW_SIGNAL }),
      ];
      const { service } = makeService({ ruleHealth: makeRuleHealth(rules) });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.ruleHealth.totalRules).toBe(10);
      expect(res.ruleHealth.healthy).toBe(1);
      expect(res.ruleHealth.needsTuning).toBe(7);
      expect(res.ruleHealth.unstable).toBe(1);
      expect(res.ruleHealth.lowSignal).toBe(1);
      expect(res.ruleHealth.topNeedsTuningRuleIds).toEqual(['nt-0', 'nt-1', 'nt-2', 'nt-3', 'nt-4']);
    });

    it('returns zeros and an empty NEEDS_TUNING list when there are no rules', async () => {
      const { service } = makeService({ ruleHealth: makeRuleHealth([]) });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');
      expect(res.ruleHealth.totalRules).toBe(0);
      expect(res.ruleHealth.topNeedsTuningRuleIds).toEqual([]);
      expect(res.ruleHealth.averageRuleScore).toBe(0);
    });
  });

  describe('simulation summary', () => {
    it('always tags isShadowMode=true and propagates the leaf summary', async () => {
      const sim = makeSimulation({
        totalRules: 12,
        totalProjectedActionDelta: -42,
        highConfidenceRuleCount: 4,
        lookbackDays: 60,
      });
      const { service } = makeService({ simulation: sim });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.simulation.isShadowMode).toBe(true);
      expect(res.simulation.totalRules).toBe(12);
      expect(res.simulation.totalProjectedActionDelta).toBe(-42);
      expect(res.simulation.highConfidenceRuleCount).toBe(4);
      expect(res.simulation.lookbackDays).toBe(60);
      expect(res.simulation.rulesByAction).toMatchObject({
        [SimulatedActionType.NO_CHANGE]:         3,
        [SimulatedActionType.TIGHTEN_THRESHOLD]: 1,
        [SimulatedActionType.DISABLE_RULE]:      0,
        [SimulatedActionType.RAISE_SCORE_FLOOR]: 1,
      });
    });
  });

  describe('autoTune status', () => {
    it('lifts lastAppliedRun fields to top-level when present', async () => {
      const obs = makeObservability({
        lastAppliedRun: makeRunSummary({
          runId: 'run-42',
          startedAt: '2026-04-29T08:00:00.000Z',
          finishedAt: '2026-04-29T08:05:00.000Z',
          appliedCount: 6,
          rolledBackCount: 2,
        }),
        cooldownActive: true,
        cooldownExpiresAt: '2026-04-29T09:05:00.000Z',
        cooldownRemainingMinutes: 17,
      });
      const { service } = makeService({ observability: obs });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.autoTune.lastRunId).toBe('run-42');
      expect(res.autoTune.lastRunStartedAt).toBe('2026-04-29T08:00:00.000Z');
      expect(res.autoTune.lastRunFinishedAt).toBe('2026-04-29T08:05:00.000Z');
      expect(res.autoTune.lastRunAppliedCount).toBe(6);
      expect(res.autoTune.lastRunRolledBackCount).toBe(2);
      expect(res.autoTune.cooldownActive).toBe(true);
      expect(res.autoTune.cooldownRemainingMinutes).toBe(17);
    });

    it('returns nulls for last-run fields when no run exists', async () => {
      const obs = makeObservability({
        totalRuns: 0,
        totalAppliedChanges: 0,
        totalRolledBackChanges: 0,
        lastAppliedRun: null,
        lastAppliedAt: null,
        cooldownActive: false,
        cooldownExpiresAt: null,
        cooldownRemainingMinutes: null,
      });
      const { service } = makeService({ observability: obs });
      const res = await service.getIntelligenceForOrg('org-1', 'user-1');

      expect(res.autoTune.totalRuns).toBe(0);
      expect(res.autoTune.lastRunId).toBeNull();
      expect(res.autoTune.lastRunStartedAt).toBeNull();
      expect(res.autoTune.lastRunFinishedAt).toBeNull();
      expect(res.autoTune.lastRunAppliedCount).toBeNull();
      expect(res.autoTune.lastRunRolledBackCount).toBeNull();
      expect(res.autoTune.cooldownActive).toBe(false);
      expect(res.autoTune.cooldownRemainingMinutes).toBeNull();
    });
  });
});

// Suppress unused-import lint for RuleTuningStatus — pulled in to keep the
// fixture builder honest if the schema changes.
void RuleTuningStatus;
