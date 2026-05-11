import { ActionType, CampaignPhase, OptimizerMode, Platform } from '@prisma/client';
import { InsightsService } from './insights.service';
import { InsightSeverity, InsightType } from './dto/insight.dto';
import { EvaluatorService } from '../optimizer/evaluator.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProposedAction } from '../optimizer/dto/proposed-action.dto';
import { EvaluationResult, SkipReason } from '../optimizer/rules/rule-handler.interface';
import { TrendAnalyzerService } from './trends/trend-analyzer.service';
import { InsightScorerService } from './scoring/insight-scorer.service';
import { InsightInteractionsService } from './interactions/insight-interactions.service';

function makeProposed(overrides: Partial<ProposedAction>): ProposedAction {
  return {
    orgId: 'org-1',
    ruleId: 'rule-1',
    entityType: 'CAMPAIGN',
    entityId: 'camp-1',
    platform: 'META' as Platform,
    actionType: ActionType.INCREASE_BUDGET,
    deltaPct: 15,
    targetValue: null,
    currentValue: 500,
    proposedValue: 575,
    explanation: { en: 'Rule "X" triggered', ar: null },
    rulePriority: 100,
    adAccountId: 'acc-1',
    adAccountCurrency: 'SAR',
    ...overrides,
  };
}

function makeSkip(overrides: Partial<SkipReason>): SkipReason {
  return {
    ruleId: 'rule-skip-1',
    entityType: 'CAMPAIGN',
    entityId: 'camp-1',
    actionType: ActionType.INCREASE_BUDGET,
    code: 'THRESHOLD_NOT_MET',
    reason: { en: 'KPI was within range', ar: null },
    context: {},
    ...overrides,
  };
}

interface MockPrisma {
  optimizerRule: { findMany: jest.Mock };
  campaign: { findMany: jest.Mock };
  adSet: { findMany: jest.Mock };
  metricSnapshot: { findMany: jest.Mock };
  insightInteraction: { findMany: jest.Mock; upsert: jest.Mock };
}

interface MockEvaluator {
  evaluateCampaign: jest.Mock<Promise<EvaluationResult>, unknown[]>;
  evaluateAdSet: jest.Mock<Promise<EvaluationResult>, unknown[]>;
}

function makeService(opts: {
  campaigns?: unknown[];
  adSets?: unknown[];
  rules?: unknown[];
  interactions?: unknown[];
  evaluateCampaign?: EvaluationResult | ((arg: unknown) => EvaluationResult);
  evaluateAdSet?: EvaluationResult | ((arg: unknown) => EvaluationResult);
}) {
  const prisma: MockPrisma = {
    optimizerRule: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { orgId: string | null } }) => {
        const rules = (opts.rules ?? []) as Array<{ orgId: string | null }>;
        return Promise.resolve(rules.filter((r) => r.orgId === where.orgId));
      }),
    },
    campaign: { findMany: jest.fn().mockResolvedValue(opts.campaigns ?? []) },
    adSet: { findMany: jest.fn().mockResolvedValue(opts.adSets ?? []) },
    // Default: no snapshots, so trend analyzer produces no signals.
    metricSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    insightInteraction: {
      findMany: jest.fn().mockResolvedValue(opts.interactions ?? []),
      upsert: jest.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ ...create, updatedAt: new Date() })),
    },
  };

  const evalCampaignImpl = opts.evaluateCampaign;
  const evalAdSetImpl = opts.evaluateAdSet;

  const evaluator: MockEvaluator = {
    evaluateCampaign: jest.fn().mockImplementation((arg: unknown) =>
      Promise.resolve(
        typeof evalCampaignImpl === 'function'
          ? evalCampaignImpl(arg)
          : evalCampaignImpl ?? { proposed: [], skipped: [] },
      ),
    ),
    evaluateAdSet: jest.fn().mockImplementation((arg: unknown) =>
      Promise.resolve(
        typeof evalAdSetImpl === 'function'
          ? evalAdSetImpl(arg)
          : evalAdSetImpl ?? { proposed: [], skipped: [] },
      ),
    ),
  };

  const interactionsService = new InsightInteractionsService(prisma as unknown as PrismaService);

  const service = new InsightsService(
    prisma as unknown as PrismaService,
    evaluator as unknown as EvaluatorService,
    new TrendAnalyzerService(),
    new InsightScorerService(),
    interactionsService,
  );

  return { service, prisma, evaluator, interactionsService };
}

const baseCampaign = {
  id: 'camp-1',
  name: 'Spring Promo',
  orgId: 'org-1',
  platform: 'META' as Platform,
  campaignPhase: CampaignPhase.STABLE,
  optimizerMode: OptimizerMode.SUGGEST_ONLY,
  optimizerEnabled: true,
  isCbo: true,
  dailyBudget: 500,
  status: 'ACTIVE',
  adAccount: { id: 'acc-1', currency: 'SAR' },
};

describe('InsightsService', () => {
  it('emits a LEARNING_PHASE insight (INFO) for campaigns in the learning phase and skips evaluation', async () => {
    const { service, evaluator } = makeService({
      campaigns: [{ ...baseCampaign, campaignPhase: CampaignPhase.LEARNING }],
      rules: [{ orgId: 'org-1' }],
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    expect(evaluator.evaluateCampaign).not.toHaveBeenCalled();
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].insightType).toBe(InsightType.LEARNING_PHASE);
    expect(result.insights[0].severity).toBe(InsightSeverity.INFO);
    expect(result.totals).toEqual({ info: 1, low: 0, medium: 0, high: 0 });
  });

  it('emits INSUFFICIENT_DATA (LOW) when evaluator returns no proposals and no skips', async () => {
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].insightType).toBe(InsightType.INSUFFICIENT_DATA);
    expect(result.insights[0].severity).toBe(InsightSeverity.LOW);
  });

  it('does not emit any INSUFFICIENT_DATA insight when there are no rules to evaluate', async () => {
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [], // no enabled rules at all
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    expect(result.insights).toHaveLength(0);
  });

  it('classifies INCREASE_BUDGET proposals as OPTIMIZATION_OPPORTUNITY (MEDIUM) and emits a READY_FOR_ACTION rollup', async () => {
    const proposed = makeProposed({ actionType: ActionType.INCREASE_BUDGET });
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [proposed], skipped: [] },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    const types = result.insights.map((i) => i.insightType);
    expect(types).toContain(InsightType.OPTIMIZATION_OPPORTUNITY);
    expect(types).toContain(InsightType.READY_FOR_ACTION);

    const opportunity = result.insights.find((i) => i.insightType === InsightType.OPTIMIZATION_OPPORTUNITY)!;
    expect(opportunity.severity).toBe(InsightSeverity.MEDIUM);
    expect(opportunity.relatedRuleId).toBe(proposed.ruleId);
    expect(opportunity.relatedActionType).toBe(ActionType.INCREASE_BUDGET);
    expect(opportunity.context.proposedValue).toBe(575);

    const ready = result.insights.find((i) => i.insightType === InsightType.READY_FOR_ACTION)!;
    expect(ready.severity).toBe(InsightSeverity.MEDIUM);
    expect(ready.context.proposedCount).toBe(1);
  });

  it('classifies DECREASE_BUDGET proposals as PERFORMANCE_RISK (HIGH) and elevates the READY_FOR_ACTION rollup to HIGH', async () => {
    const proposed = makeProposed({
      actionType: ActionType.DECREASE_BUDGET,
      deltaPct: -20,
      currentValue: 500,
      proposedValue: 400,
    });

    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [proposed], skipped: [] },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    const risk = result.insights.find((i) => i.insightType === InsightType.PERFORMANCE_RISK)!;
    expect(risk.severity).toBe(InsightSeverity.HIGH);

    const ready = result.insights.find((i) => i.insightType === InsightType.READY_FOR_ACTION)!;
    expect(ready.severity).toBe(InsightSeverity.HIGH);

    expect(result.totals.high).toBe(2);
  });

  it('groups skipped reasons by code (one insight per code, not per rule)', async () => {
    const skips: SkipReason[] = [
      makeSkip({ ruleId: 'r1', code: 'THRESHOLD_NOT_MET' }),
      makeSkip({ ruleId: 'r2', code: 'THRESHOLD_NOT_MET' }),
      makeSkip({ ruleId: 'r3', code: 'INSUFFICIENT_SAMPLE' }),
    ];

    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: skips },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    const ruleNotTriggered = result.insights.find((i) => i.insightType === InsightType.RULE_NOT_TRIGGERED);
    const insufficient = result.insights.find((i) => i.insightType === InsightType.INSUFFICIENT_DATA);

    expect(ruleNotTriggered).toBeDefined();
    expect(ruleNotTriggered!.severity).toBe(InsightSeverity.INFO);
    expect(ruleNotTriggered!.context.ruleCount).toBe(2);
    expect(ruleNotTriggered!.context.affectedRuleIds).toEqual(['r1', 'r2']);

    expect(insufficient).toBeDefined();
    expect(insufficient!.severity).toBe(InsightSeverity.LOW);
    expect(insufficient!.context.ruleCount).toBe(1);
  });

  it('sorts insights by severity descending (HIGH → MEDIUM → LOW → INFO)', async () => {
    const learningCampaign = {
      ...baseCampaign,
      id: 'camp-info',
      name: 'A Learning',
      campaignPhase: CampaignPhase.LEARNING,
    };
    const riskCampaign = { ...baseCampaign, id: 'camp-risk', name: 'Z Risk' };

    const { service } = makeService({
      campaigns: [learningCampaign, riskCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: (arg: unknown) => {
        const c = arg as { id: string };
        if (c.id === 'camp-risk') {
          return { proposed: [makeProposed({ entityId: 'camp-risk', actionType: ActionType.DECREASE_BUDGET })], skipped: [] };
        }
        return { proposed: [], skipped: [] };
      },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    const severities = result.insights.map((i) => i.severity);
    // First insights should be HIGH (PERFORMANCE_RISK + READY_FOR_ACTION on Z Risk)
    expect(severities[0]).toBe(InsightSeverity.HIGH);
    expect(severities[severities.length - 1]).toBe(InsightSeverity.INFO);
  });

  it('applies platform / severity / insightType filters', async () => {
    const proposedMeta = makeProposed({ actionType: ActionType.INCREASE_BUDGET });
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [proposedMeta], skipped: [] },
    });

    const tikTokFiltered = await service.listForOrg('org-1', 'user-1', { platform: 'TIKTOK' });
    expect(tikTokFiltered.insights).toHaveLength(0);

    const mediumOnly = await service.listForOrg('org-1', 'user-1', { severity: InsightSeverity.MEDIUM });
    expect(mediumOnly.insights.every((i) => i.severity === InsightSeverity.MEDIUM)).toBe(true);

    const opportunitiesOnly = await service.listForOrg('org-1', 'user-1', { insightType: InsightType.OPTIMIZATION_OPPORTUNITY });
    expect(opportunitiesOnly.insights).toHaveLength(1);
    expect(opportunitiesOnly.insights[0].insightType).toBe(InsightType.OPTIMIZATION_OPPORTUNITY);
  });

  it('listForCampaign restricts to one campaign id', async () => {
    const { service, prisma } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    await service.listForCampaign('org-1', 'user-1', 'camp-1', {});

    const lastCampaignCall = (prisma.campaign.findMany as jest.Mock).mock.calls[0][0];
    expect(lastCampaignCall.where.id).toBe('camp-1');

    const lastAdSetCall = (prisma.adSet.findMany as jest.Mock).mock.calls[0][0];
    expect(lastAdSetCall.where.campaignId).toBe('camp-1');
  });

  it('produces deterministic ids based on entity + source so the same request is stable', async () => {
    const proposed = makeProposed({});
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [proposed], skipped: [] },
    });

    const a = await service.listForOrg('org-1', 'user-1', {});
    const b = await service.listForOrg('org-1', 'user-1', {});

    const idsA = a.insights.map((i) => i.id).sort();
    const idsB = b.insights.map((i) => i.id).sort();
    expect(idsA).toEqual(idsB);
  });

  // ─── Trend & Pattern Intelligence integration ─────────────────────────────

  function snapshotRow(windowHours: 24 | 48 | 72, values: Record<string, unknown>) {
    return {
      windowHours,
      entityType: 'CAMPAIGN' as const,
      entityId: 'camp-1',
      snapshotDate: new Date(),
      spend: 0,
      impressions: 5000,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      roas: 0,
      spendPacing: 1,
      ...values,
    };
  }

  it('emits a TREND_UP insight (INFO) when ROAS is monotonically improving', async () => {
    const { service, prisma } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    // ROAS climbing: 3.0 → 3.3 → 3.6 (overall +20%, monotonic, HIGH confidence)
    (prisma.metricSnapshot.findMany as jest.Mock).mockResolvedValue([
      snapshotRow(24, { roas: 3.6 }),
      snapshotRow(48, { roas: 3.3 }),
      snapshotRow(72, { roas: 3.0 }),
    ]);

    const result = await service.listForOrg('org-1', 'user-1', {});
    const trendUp = result.insights.find((i) => i.insightType === InsightType.TREND_UP);

    expect(trendUp).toBeDefined();
    expect(trendUp!.severity).toBe(InsightSeverity.INFO);
    expect(trendUp!.context.metric).toBe('roas');
    expect(trendUp!.context.confidence).toBe('HIGH');
    expect(trendUp!.relatedRuleId).toBeNull();
  });

  it('emits a TREND_DOWN insight at HIGH severity when CPA is monotonically rising with high confidence', async () => {
    const { service, prisma } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    // CPA: 20 → 25 → 30 (rising = degrading because lower-is-better)
    (prisma.metricSnapshot.findMany as jest.Mock).mockResolvedValue([
      snapshotRow(24, { cpa: 30 }),
      snapshotRow(48, { cpa: 25 }),
      snapshotRow(72, { cpa: 20 }),
    ]);

    const result = await service.listForOrg('org-1', 'user-1', {});
    const trendDown = result.insights.find((i) => i.insightType === InsightType.TREND_DOWN);

    expect(trendDown).toBeDefined();
    expect(trendDown!.severity).toBe(InsightSeverity.HIGH);
    expect(trendDown!.context.metric).toBe('cpa');
    expect(trendDown!.context.higherIsBetter).toBe(false);
  });

  it('emits a VOLATILITY_HIGH insight when steps oppose with significant magnitudes', async () => {
    const { service, prisma } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    // ROAS: 4.0 → 5.0 → 4.0 (large opposing swings)
    (prisma.metricSnapshot.findMany as jest.Mock).mockResolvedValue([
      snapshotRow(24, { roas: 4.0 }),
      snapshotRow(48, { roas: 5.0 }),
      snapshotRow(72, { roas: 4.0 }),
    ]);

    const result = await service.listForOrg('org-1', 'user-1', {});
    const volatility = result.insights.find((i) => i.insightType === InsightType.VOLATILITY_HIGH);

    expect(volatility).toBeDefined();
    expect(volatility!.severity).toBe(InsightSeverity.MEDIUM); // HIGH confidence → MEDIUM severity
    expect(volatility!.context.metric).toBe('roas');
  });

  it('emits a PERFORMANCE_STAGNANT rollup when 2+ metrics are flat across the 72h window', async () => {
    const { service, prisma } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    // ROAS, CTR, CPA all flat (within 3% step band)
    (prisma.metricSnapshot.findMany as jest.Mock).mockResolvedValue([
      snapshotRow(24, { roas: 4.01, ctr: 0.0501, cpa: 20.05 }),
      snapshotRow(48, { roas: 4.0, ctr: 0.05, cpa: 20.0 }),
      snapshotRow(72, { roas: 4.0, ctr: 0.05, cpa: 20.0 }),
    ]);

    const result = await service.listForOrg('org-1', 'user-1', {});
    const stagnant = result.insights.find((i) => i.insightType === InsightType.PERFORMANCE_STAGNANT);

    expect(stagnant).toBeDefined();
    expect(stagnant!.severity).toBe(InsightSeverity.LOW);
    expect((stagnant!.context.flatMetrics as string[]).length).toBeGreaterThanOrEqual(2);
  });

  // ─── Insight Scoring & Prioritization integration ─────────────────────────

  it('attaches score, priority, and scoreBreakdown to every insight', async () => {
    const proposed = makeProposed({});
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [proposed], skipped: [] },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});
    expect(result.insights.length).toBeGreaterThan(0);
    for (const i of result.insights) {
      expect(typeof i.score).toBe('number');
      expect(i.score).toBeGreaterThanOrEqual(0);
      expect(i.score).toBeLessThanOrEqual(100);
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(i.priority);
      expect(i.scoreBreakdown.total).toBe(i.score);
      expect(i.scoreBreakdown.severity).toBeDefined();
      expect(i.scoreBreakdown.impact).toBeDefined();
      expect(i.scoreBreakdown.actionability).toBeDefined();
    }
  });

  it('orders insights by score descending across multiple campaigns', async () => {
    const big = { ...baseCampaign, id: 'big', name: 'Big Spender' };
    const small = { ...baseCampaign, id: 'small', name: 'Small Test' };

    const { service } = makeService({
      campaigns: [big, small],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: (arg: unknown) => {
        const c = arg as { id: string };
        if (c.id === 'big') {
          return {
            proposed: [makeProposed({
              entityId: 'big',
              actionType: ActionType.DECREASE_BUDGET,
              currentValue: 10000, // big budget → high impact factor
              deltaPct: -25,
            })],
            skipped: [],
          };
        }
        return {
          proposed: [makeProposed({
            entityId: 'small',
            actionType: ActionType.DECREASE_BUDGET,
            currentValue: 50, // tiny budget → low impact factor
            deltaPct: -25,
          })],
          skipped: [],
        };
      },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});
    const scores = result.insights.map((i) => i.score);
    for (let k = 1; k < scores.length; k++) {
      expect(scores[k - 1]).toBeGreaterThanOrEqual(scores[k]);
    }

    // Big-budget risk should outrank the same-severity small-budget risk.
    const bigRisk = result.insights.find(
      (i) => i.entityId === 'big' && i.insightType === InsightType.PERFORMANCE_RISK,
    )!;
    const smallRisk = result.insights.find(
      (i) => i.entityId === 'small' && i.insightType === InsightType.PERFORMANCE_RISK,
    )!;
    expect(bigRisk.score).toBeGreaterThan(smallRisk.score);
  });

  it('produces CRITICAL priority for HIGH-severity, large-budget, high-magnitude actions', async () => {
    const { service } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: {
        proposed: [makeProposed({
          actionType: ActionType.DECREASE_BUDGET,
          currentValue: 8000,
          proposedValue: 6000,
          deltaPct: -25,
        })],
        skipped: [],
      },
    });

    const result = await service.listForOrg('org-1', 'user-1', {});
    const risk = result.insights.find((i) => i.insightType === InsightType.PERFORMANCE_RISK)!;
    expect(risk.priority).toBe('CRITICAL');
  });

  it('does not emit any trend insights when 24h impressions are below the minimum sample', async () => {
    const { service, prisma } = makeService({
      campaigns: [baseCampaign],
      rules: [{ orgId: 'org-1' }],
      evaluateCampaign: { proposed: [], skipped: [] },
    });

    (prisma.metricSnapshot.findMany as jest.Mock).mockResolvedValue([
      snapshotRow(24, { roas: 3.6, impressions: 100 }),
      snapshotRow(48, { roas: 3.3, impressions: 100 }),
      snapshotRow(72, { roas: 3.0, impressions: 100 }),
    ]);

    const result = await service.listForOrg('org-1', 'user-1', {});
    const trendInsights = result.insights.filter((i) =>
      i.insightType === InsightType.TREND_UP ||
      i.insightType === InsightType.TREND_DOWN ||
      i.insightType === InsightType.VOLATILITY_HIGH ||
      i.insightType === InsightType.PERFORMANCE_STAGNANT,
    );
    expect(trendInsights).toHaveLength(0);
  });

  // ─── Interaction overlay (Phase E) ─────────────────────────────────────────

  it('leaves overlay fields null on insights that the caller has never interacted with', async () => {
    const { service } = makeService({
      campaigns: [{ ...baseCampaign, campaignPhase: CampaignPhase.LEARNING }],
      rules: [{ orgId: 'org-1' }],
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    expect(result.insights).toHaveLength(1);
    const i = result.insights[0];
    expect(i.userStatus).toBeNull();
    expect(i.feedback).toBeNull();
    expect(i.userNote).toBeNull();
    expect(i.interactedAt).toBeNull();
  });

  it('merges userStatus / feedback / userNote / interactedAt onto matching insights when an interaction exists', async () => {
    // Pre-compute the deterministic insight id the LEARNING_PHASE branch will produce.
    const { createHash } = await import('node:crypto');
    const insightId =
      'ins_' +
      createHash('sha1')
        .update('org-1:CAMPAIGN:camp-1:learning')
        .digest('hex')
        .slice(0, 24);

    const interactedAt = new Date('2026-05-01T12:34:56.000Z');

    const { service } = makeService({
      campaigns: [{ ...baseCampaign, campaignPhase: CampaignPhase.LEARNING }],
      rules: [{ orgId: 'org-1' }],
      interactions: [
        {
          id: 'int-1',
          insightId,
          orgId: 'org-1',
          userId: 'user-1',
          status: 'DISMISSED',
          feedback: 'NOT_USEFUL',
          note: 'Already aware of this',
          createdAt: interactedAt,
          updatedAt: interactedAt,
        },
      ],
    });

    const result = await service.listForOrg('org-1', 'user-1', {});

    expect(result.insights).toHaveLength(1);
    const i = result.insights[0];
    expect(i.id).toBe(insightId);
    expect(i.userStatus).toBe('DISMISSED');
    expect(i.feedback).toBe('NOT_USEFUL');
    expect(i.userNote).toBe('Already aware of this');
    expect(i.interactedAt).toBe(interactedAt.toISOString());
  });

  it('queries InsightInteractionsService scoped to the caller (orgId + userId)', async () => {
    const { service, prisma } = makeService({
      campaigns: [{ ...baseCampaign, campaignPhase: CampaignPhase.LEARNING }],
      rules: [{ orgId: 'org-1' }],
    });

    await service.listForOrg('org-1', 'user-42', {});

    expect(prisma.insightInteraction.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.insightInteraction.findMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', userId: 'user-42' },
    });
  });

  it('does not leak one user\'s overlay onto another user\'s insights', async () => {
    // Interaction belongs to user-1, but user-2 is asking — the mock filters
    // by userId in the where clause, so user-2 should see no overlay.
    const { createHash } = await import('node:crypto');
    const insightId =
      'ins_' +
      createHash('sha1')
        .update('org-1:CAMPAIGN:camp-1:learning')
        .digest('hex')
        .slice(0, 24);

    const { service, prisma } = makeService({
      campaigns: [{ ...baseCampaign, campaignPhase: CampaignPhase.LEARNING }],
      rules: [{ orgId: 'org-1' }],
    });

    // Override the default mock to enforce userId filtering.
    prisma.insightInteraction.findMany.mockImplementation(
      ({ where }: { where: { userId: string } }) => {
        const all = [
          {
            id: 'int-1',
            insightId,
            orgId: 'org-1',
            userId: 'user-1',
            status: 'SAVED',
            feedback: null,
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        return Promise.resolve(all.filter((r) => r.userId === where.userId));
      },
    );

    const result = await service.listForOrg('org-1', 'user-2', {});
    const i = result.insights[0];
    expect(i.userStatus).toBeNull();
    expect(i.feedback).toBeNull();
  });
});
