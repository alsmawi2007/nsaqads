import { InsightFeedback, InsightInteraction, InsightInteractionStatus } from '@prisma/client';
import {
  RulePerformanceService,
  classifyHealth,
  computeBreakdown,
  computeConfidence,
  computeRuleScore,
} from './rule-performance.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RATE_THRESHOLDS,
  RuleHealth,
  RuleHealthConfidence,
  RuleRecommendedAction,
  SAMPLE_THRESHOLDS,
} from './rule-performance.types';

interface MockPrisma {
  insightInteraction: { findMany: jest.Mock };
}

function row(overrides: Partial<InsightInteraction> = {}): InsightInteraction {
  return {
    id: 'i-' + Math.random().toString(36).slice(2, 8),
    insightId: 'ins_x',
    orgId: 'org-1',
    userId: 'user-1',
    status: null,
    feedback: null,
    note: null,
    insightType: null,
    severity: null,
    priority: null,
    relatedRuleId: 'rule-A',
    relatedActionType: null,
    platform: null,
    entityType: null,
    entityId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as InsightInteraction;
}

// Build N interactions for a single rule with a feedback distribution.
function many(opts: {
  ruleId?: string;
  orgId?: string;
  useful?: number;
  notUseful?: number;
  wrong?: number;
  needsContext?: number;
  statusOnly?: number;
}): InsightInteraction[] {
  const out: InsightInteraction[] = [];
  const r = opts.ruleId ?? 'rule-A';
  const o = opts.orgId ?? 'org-1';
  const push = (fb: InsightFeedback | null, status: InsightInteractionStatus | null = null) =>
    out.push(row({ relatedRuleId: r, orgId: o, feedback: fb, status }));
  for (let i = 0; i < (opts.useful ?? 0); i++)        push(InsightFeedback.USEFUL);
  for (let i = 0; i < (opts.notUseful ?? 0); i++)     push(InsightFeedback.NOT_USEFUL);
  for (let i = 0; i < (opts.wrong ?? 0); i++)         push(InsightFeedback.WRONG);
  for (let i = 0; i < (opts.needsContext ?? 0); i++)  push(InsightFeedback.NEEDS_MORE_CONTEXT);
  for (let i = 0; i < (opts.statusOnly ?? 0); i++)    push(null, InsightInteractionStatus.SEEN);
  return out;
}

function makeService(rows: InsightInteraction[]) {
  const prisma: MockPrisma = {
    insightInteraction: {
      findMany: jest.fn().mockImplementation(({ where }: { where?: { orgId?: string } } = {}) => {
        if (where?.orgId === undefined) return Promise.resolve(rows);
        return Promise.resolve(rows.filter((r) => r.orgId === where.orgId));
      }),
    },
  };
  const service = new RulePerformanceService(prisma as unknown as PrismaService);
  return { service, prisma };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('rule-performance pure helpers', () => {
  describe('computeBreakdown', () => {
    it('counts feedback, leaves rates at 0 when no feedback exists', () => {
      const b = computeBreakdown(many({ statusOnly: 5 }));
      expect(b.interactionCount).toBe(5);
      expect(b.withFeedbackCount).toBe(0);
      expect(b.usefulRate).toBe(0);
      expect(b.wrongRate).toBe(0);
    });

    it('computes feedback rates over withFeedbackCount only', () => {
      const b = computeBreakdown(many({ useful: 6, wrong: 2, statusOnly: 10 }));
      // 8 feedback rows total, status-only rows must NOT dilute
      expect(b.withFeedbackCount).toBe(8);
      expect(b.usefulRate).toBe(0.75);
      expect(b.wrongRate).toBe(0.25);
    });
  });

  describe('computeConfidence', () => {
    it('LOW until MEDIUM_CONFIDENCE, MEDIUM until HIGH_CONFIDENCE, HIGH at saturation', () => {
      expect(computeConfidence(SAMPLE_THRESHOLDS.MEDIUM_CONFIDENCE - 1)).toBe(RuleHealthConfidence.LOW);
      expect(computeConfidence(SAMPLE_THRESHOLDS.MEDIUM_CONFIDENCE)).toBe(RuleHealthConfidence.MEDIUM);
      expect(computeConfidence(SAMPLE_THRESHOLDS.HIGH_CONFIDENCE - 1)).toBe(RuleHealthConfidence.MEDIUM);
      expect(computeConfidence(SAMPLE_THRESHOLDS.HIGH_CONFIDENCE)).toBe(RuleHealthConfidence.HIGH);
      expect(computeConfidence(500)).toBe(RuleHealthConfidence.HIGH);
    });
  });

  describe('computeRuleScore', () => {
    it('returns near-0 for a rule with no feedback regardless of sample size', () => {
      const b = computeBreakdown(many({ statusOnly: 50 }));
      const score = computeRuleScore(b);
      // Only the sample-size component contributes — capped at SAMPLE weight × 100 = 10.
      expect(score).toBeLessThanOrEqual(10);
    });

    it('rewards usefulRate strictly more than (1 - wrongRate)', () => {
      // Two breakdowns with the same overall split but inverted "good" axis.
      const allUseful = computeBreakdown(many({ useful: 100 }));        // useful=1, wrong=0
      const noWrong   = computeBreakdown(many({ useful: 0, notUseful: 100 })); // useful=0, wrong=0
      // Both have wrongRate=0 but allUseful has usefulRate=1 — must score higher.
      expect(computeRuleScore(allUseful)).toBeGreaterThan(computeRuleScore(noWrong));
    });

    it('is monotonic in sample size when rates are held fixed', () => {
      const small = computeBreakdown(many({ useful: 10, wrong: 0 }));
      const big   = computeBreakdown(many({ useful: 100, wrong: 0 }));
      // Same usefulRate but bigger sample → strictly higher score (sample factor saturates).
      expect(computeRuleScore(big)).toBeGreaterThan(computeRuleScore(small));
    });

    it('penalizes high wrongRate', () => {
      const allWrong  = computeBreakdown(many({ wrong: 100 }));
      const allUseful = computeBreakdown(many({ useful: 100 }));
      expect(computeRuleScore(allUseful)).toBeGreaterThan(computeRuleScore(allWrong));
      // allWrong: usefulRate=0, wrongRate=1, sample saturated → 0+0+0.1+0.1 ≈ 20
      expect(computeRuleScore(allWrong)).toBeLessThan(30);
    });

    it('produces 0..100 bounded scores in normal cases', () => {
      const breakdowns = [
        many({ useful: 100 }),
        many({ wrong: 100 }),
        many({ useful: 50, wrong: 50 }),
        many({ useful: 30, wrong: 30, notUseful: 30, needsContext: 10 }),
      ].map(computeBreakdown);
      for (const b of breakdowns) {
        const score = computeRuleScore(b);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('classifyHealth', () => {
    it('LOW_SIGNAL when interactionCount below MIN_FOR_CLASSIFICATION', () => {
      const b = computeBreakdown(many({ useful: SAMPLE_THRESHOLDS.MIN_FOR_CLASSIFICATION - 1 }));
      expect(classifyHealth(b).health).toBe(RuleHealth.LOW_SIGNAL);
    });

    it('LOW_SIGNAL when sample is sufficient but no feedback verdicts', () => {
      const b = computeBreakdown(many({ statusOnly: 50 }));
      expect(classifyHealth(b).health).toBe(RuleHealth.LOW_SIGNAL);
    });

    it('NEEDS_TUNING when wrongRate ≥ TUNING_WRONG_MIN, even if useful is also high', () => {
      // 50% useful, 35% wrong over 20 feedback rows
      const rows = many({ useful: 10, wrong: 7, notUseful: 3 });
      const b = computeBreakdown(rows);
      expect(b.wrongRate).toBeGreaterThanOrEqual(RATE_THRESHOLDS.TUNING_WRONG_MIN);
      expect(classifyHealth(b).health).toBe(RuleHealth.NEEDS_TUNING);
    });

    it('UNSTABLE when usefulRate ≥ 25% AND wrongRate ≥ 25% but below tuning threshold', () => {
      // 40% useful, 27% wrong → split verdict, wrong below 30%.
      const rows = many({ useful: 12, wrong: 8, notUseful: 10 });
      const b = computeBreakdown(rows);
      expect(b.wrongRate).toBeLessThan(RATE_THRESHOLDS.TUNING_WRONG_MIN);
      expect(b.usefulRate).toBeGreaterThanOrEqual(RATE_THRESHOLDS.UNSTABLE_USEFUL_MIN);
      expect(b.wrongRate).toBeGreaterThanOrEqual(RATE_THRESHOLDS.UNSTABLE_WRONG_MIN);
      expect(classifyHealth(b).health).toBe(RuleHealth.UNSTABLE);
    });

    it('HEALTHY when usefulRate ≥ 65% and wrongRate ≤ 15%', () => {
      const rows = many({ useful: 80, notUseful: 10, wrong: 10 }); // 80% useful, 10% wrong
      const b = computeBreakdown(rows);
      expect(classifyHealth(b).health).toBe(RuleHealth.HEALTHY);
    });

    it('falls back to UNSTABLE when none of the bands cleanly match', () => {
      // 50% useful, 0% wrong, 50% needs more context → not HEALTHY (useful below 65)
      // and not NEEDS_TUNING (wrong below 30) and not classic UNSTABLE (wrong below 25).
      const rows = many({ useful: 10, needsContext: 10 });
      const b = computeBreakdown(rows);
      expect(classifyHealth(b).health).toBe(RuleHealth.UNSTABLE);
    });

    it('attaches at least one human-readable reason', () => {
      const b = computeBreakdown(many({ useful: 80, wrong: 10, notUseful: 10 }));
      const { reasons } = classifyHealth(b);
      expect(reasons.length).toBeGreaterThan(0);
      expect(typeof reasons[0]).toBe('string');
    });
  });
});

// ─── Service ─────────────────────────────────────────────────────────────────

describe('RulePerformanceService', () => {
  describe('getForOrg', () => {
    it('produces one entry per ruleId scoped to the requested org', async () => {
      const { service, prisma } = makeService([
        ...many({ ruleId: 'rule-A', orgId: 'org-1', useful: 80, wrong: 10, notUseful: 10 }),
        ...many({ ruleId: 'rule-B', orgId: 'org-1', wrong: 50, useful: 10, notUseful: 5 }),
        ...many({ ruleId: 'rule-A', orgId: 'org-2', useful: 200 }), // different org — must not leak
      ]);

      const result = await service.getForOrg('org-1');

      expect(prisma.insightInteraction.findMany).toHaveBeenCalledWith({ where: { orgId: 'org-1' } });
      expect(result.scope).toBe('org-1');
      expect(result.rules).toHaveLength(2);

      const a = result.rules.find((r) => r.ruleId === 'rule-A')!;
      const b = result.rules.find((r) => r.ruleId === 'rule-B')!;
      expect(a.health).toBe(RuleHealth.HEALTHY);
      expect(b.health).toBe(RuleHealth.NEEDS_TUNING);
      // org-2's rule-A volume must not affect org-1's rule-A breakdown.
      expect(a.breakdown.interactionCount).toBe(100);
    });

    it('counts rows without relatedRuleId as uncategorized', async () => {
      const { service } = makeService([
        ...many({ ruleId: 'rule-A', useful: 100 }),
        // 5 trend insights without a rule
        row({ relatedRuleId: null, feedback: InsightFeedback.USEFUL }),
        row({ relatedRuleId: null, feedback: InsightFeedback.WRONG }),
        row({ relatedRuleId: null, status: InsightInteractionStatus.SEEN }),
        row({ relatedRuleId: null, status: InsightInteractionStatus.DISMISSED }),
        row({ relatedRuleId: null, status: InsightInteractionStatus.SAVED }),
      ]);

      const result = await service.getForOrg('org-1');
      expect(result.rules).toHaveLength(1);
      expect(result.uncategorizedCount).toBe(5);
    });

    it('sorts rules: NEEDS_TUNING < UNSTABLE < HEALTHY < LOW_SIGNAL, then ascending ruleScore', async () => {
      const { service } = makeService([
        ...many({ ruleId: 'healthy',  useful: 100 }),
        ...many({ ruleId: 'tuning',   wrong: 60, useful: 40 }),
        ...many({ ruleId: 'unstable', useful: 12, wrong: 8, notUseful: 10 }),
        ...many({ ruleId: 'low',      useful: 3 }), // < MIN sample
      ]);

      const result = await service.getForOrg('org-1');
      const order = result.rules.map((r) => r.ruleId);
      expect(order[0]).toBe('tuning');
      expect(order[1]).toBe('unstable');
      expect(order[2]).toBe('healthy');
      expect(order[3]).toBe('low');
    });

    it('summary aggregates band counts and excludes LOW_SIGNAL from average ruleScore', async () => {
      const { service } = makeService([
        ...many({ ruleId: 'healthy', useful: 100 }),
        ...many({ ruleId: 'low',     useful: 2 }),
      ]);

      const result = await service.getForOrg('org-1');
      expect(result.summary.totalRules).toBe(2);
      expect(result.summary.byHealth.HEALTHY).toBe(1);
      expect(result.summary.byHealth.LOW_SIGNAL).toBe(1);
      // Average is over the HEALTHY rule only — the LOW_SIGNAL rule's
      // near-zero score is correctly excluded.
      expect(result.summary.averageRuleScore).toBeGreaterThan(70);
    });
  });

  describe('getForAllOrgs', () => {
    it('aggregates across orgs under scope "ALL"', async () => {
      const { service, prisma } = makeService([
        ...many({ ruleId: 'rule-X', orgId: 'org-1', useful: 50, wrong: 5 }),
        ...many({ ruleId: 'rule-X', orgId: 'org-2', useful: 50, wrong: 5 }),
      ]);

      const result = await service.getForAllOrgs();

      expect(prisma.insightInteraction.findMany).toHaveBeenCalledWith({});
      expect(result.scope).toBe('ALL');
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0].breakdown.interactionCount).toBe(110);
    });
  });

  describe('hooks', () => {
    it('HEALTHY rule with high score proposes a score floor', async () => {
      const { service } = makeService(many({ ruleId: 'r1', useful: 200 }));
      const result = await service.getForOrg('org-1');
      const r = result.rules[0];
      expect(r.health).toBe(RuleHealth.HEALTHY);
      expect(r.hooks.recommendedAction).toBe(RuleRecommendedAction.NO_ACTION);
      expect(r.hooks.proposedScoreFloor).not.toBeNull();
      expect(r.hooks.shouldConsiderDisable).toBe(false);
    });

    it('NEEDS_TUNING rule with very high wrongRate suggests CONSIDER_DISABLE', async () => {
      const { service } = makeService(many({ ruleId: 'r1', wrong: 80, useful: 10, notUseful: 10 }));
      const result = await service.getForOrg('org-1');
      const r = result.rules[0];
      expect(r.health).toBe(RuleHealth.NEEDS_TUNING);
      expect(r.hooks.recommendedAction).toBe(RuleRecommendedAction.CONSIDER_DISABLE);
      expect(r.hooks.shouldConsiderDisable).toBe(true);
    });

    it('NEEDS_TUNING rule with moderate wrongRate suggests CONSIDER_TUNING (no disable)', async () => {
      const { service } = makeService(many({ ruleId: 'r1', wrong: 35, useful: 50, notUseful: 15 }));
      const result = await service.getForOrg('org-1');
      const r = result.rules[0];
      expect(r.health).toBe(RuleHealth.NEEDS_TUNING);
      expect(r.hooks.recommendedAction).toBe(RuleRecommendedAction.CONSIDER_TUNING);
      expect(r.hooks.shouldConsiderDisable).toBe(false);
      expect(r.hooks.proposedThresholdDelta).toBeLessThan(0);
    });

    it('LOW_SIGNAL rule recommends COLLECT_MORE_DATA and proposes nothing', async () => {
      const { service } = makeService(many({ ruleId: 'r1', useful: 3 }));
      const result = await service.getForOrg('org-1');
      const r = result.rules[0];
      expect(r.health).toBe(RuleHealth.LOW_SIGNAL);
      expect(r.hooks.recommendedAction).toBe(RuleRecommendedAction.COLLECT_MORE_DATA);
      expect(r.hooks.proposedThresholdDelta).toBeNull();
      expect(r.hooks.proposedScoreFloor).toBeNull();
    });

    it('UNSTABLE rule recommends REVIEW (manual, no auto-action)', async () => {
      const { service } = makeService(many({ ruleId: 'r1', useful: 12, wrong: 8, notUseful: 10 }));
      const result = await service.getForOrg('org-1');
      const r = result.rules[0];
      expect(r.health).toBe(RuleHealth.UNSTABLE);
      expect(r.hooks.recommendedAction).toBe(RuleRecommendedAction.REVIEW);
      expect(r.hooks.shouldConsiderDisable).toBe(false);
    });
  });
});
