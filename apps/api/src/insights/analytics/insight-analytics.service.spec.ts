import {
  ActionType,
  InsightFeedback,
  InsightInteraction,
  InsightInteractionStatus,
  Platform,
} from '@prisma/client';
import { InsightAnalyticsService } from './insight-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    relatedRuleId: null,
    relatedActionType: null,
    platform: null,
    entityType: null,
    entityId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InsightInteraction;
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
  const service = new InsightAnalyticsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('InsightAnalyticsService', () => {
  describe('getForOrg — totals', () => {
    it('counts status and feedback over disjoint denominators', async () => {
      const { service } = makeService([
        // 3 with status only
        row({ status: InsightInteractionStatus.SEEN }),
        row({ status: InsightInteractionStatus.DISMISSED }),
        row({ status: InsightInteractionStatus.SAVED }),
        // 4 with feedback (status independent)
        row({ feedback: InsightFeedback.USEFUL }),
        row({ feedback: InsightFeedback.USEFUL }),
        row({ feedback: InsightFeedback.NOT_USEFUL }),
        row({ feedback: InsightFeedback.WRONG }),
        // 1 with both
        row({ status: InsightInteractionStatus.SEEN, feedback: InsightFeedback.NEEDS_MORE_CONTEXT }),
      ]);

      const result = await service.getForOrg('org-1');

      expect(result.totals.interactionCount).toBe(8);
      expect(result.totals.withStatusCount).toBe(4); // 3 status-only + 1 with-both
      expect(result.totals.withFeedbackCount).toBe(5); // 4 fb-only + 1 with-both
      expect(result.totals.statusCounts).toEqual({ SEEN: 2, DISMISSED: 1, SAVED: 1 });
      expect(result.totals.feedbackCounts).toEqual({
        USEFUL: 2, NOT_USEFUL: 1, WRONG: 1, NEEDS_MORE_CONTEXT: 1,
      });
    });

    it('computes rates over subset denominators (status row does not affect feedback rates)', async () => {
      const { service } = makeService([
        // 2 SEEN-only rows
        row({ status: InsightInteractionStatus.SEEN }),
        row({ status: InsightInteractionStatus.SEEN }),
        // 4 feedback rows: 3 USEFUL + 1 WRONG
        row({ feedback: InsightFeedback.USEFUL }),
        row({ feedback: InsightFeedback.USEFUL }),
        row({ feedback: InsightFeedback.USEFUL }),
        row({ feedback: InsightFeedback.WRONG }),
      ]);

      const result = await service.getForOrg('org-1');

      // Feedback rates: 3/4 useful, 1/4 wrong — SEEN rows do NOT dilute.
      expect(result.totals.rates.usefulRate).toBe(0.75);
      expect(result.totals.rates.wrongRate).toBe(0.25);
      expect(result.totals.rates.notUsefulRate).toBe(0);
      // Status rates: 2/2 SEEN — feedback rows do NOT dilute.
      expect(result.totals.rates.seenRate).toBe(1);
      expect(result.totals.rates.dismissedRate).toBe(0);
    });

    it('returns 0 (not NaN) for rates when no rows have status or feedback', async () => {
      const { service } = makeService([row()]); // single row with no status, no feedback

      const result = await service.getForOrg('org-1');

      // Every rate must be a finite 0 — not NaN from a 0/0 division.
      for (const rate of Object.values(result.totals.rates)) {
        expect(Number.isFinite(rate)).toBe(true);
        expect(rate).toBe(0);
      }
    });
  });

  describe('getForOrg — per-dimension breakdowns', () => {
    it('aggregates by insightType and sorts by interaction volume desc', async () => {
      const { service } = makeService([
        row({ insightType: 'OPTIMIZATION_OPPORTUNITY', feedback: InsightFeedback.USEFUL }),
        row({ insightType: 'OPTIMIZATION_OPPORTUNITY', feedback: InsightFeedback.USEFUL }),
        row({ insightType: 'OPTIMIZATION_OPPORTUNITY', feedback: InsightFeedback.WRONG }),
        row({ insightType: 'TREND_DOWN', status: InsightInteractionStatus.SEEN }),
      ]);

      const result = await service.getForOrg('org-1');

      const opp = result.byInsightType.find((b) => b.key === 'OPTIMIZATION_OPPORTUNITY')!;
      const trend = result.byInsightType.find((b) => b.key === 'TREND_DOWN')!;
      expect(opp.interactionCount).toBe(3);
      expect(trend.interactionCount).toBe(1);
      expect(opp.rates.usefulRate).toBeCloseTo(2 / 3, 4);
      expect(opp.rates.wrongRate).toBeCloseTo(1 / 3, 4);
      // Larger bucket first.
      expect(result.byInsightType[0].key).toBe('OPTIMIZATION_OPPORTUNITY');
    });

    it('aggregates by platform; null platform sorts last', async () => {
      const { service } = makeService([
        row({ platform: Platform.META, feedback: InsightFeedback.USEFUL }),
        row({ platform: Platform.META, feedback: InsightFeedback.USEFUL }),
        row({ platform: Platform.TIKTOK, feedback: InsightFeedback.WRONG }),
        row({ feedback: InsightFeedback.NOT_USEFUL }), // no platform captured
      ]);

      const result = await service.getForOrg('org-1');

      // Last bucket is the null one.
      expect(result.byPlatform[result.byPlatform.length - 1].key).toBeNull();
      expect(result.byPlatform[0].key).toBe('META');
    });

    it('aggregates by user', async () => {
      const { service } = makeService([
        row({ userId: 'user-A', feedback: InsightFeedback.USEFUL }),
        row({ userId: 'user-A', feedback: InsightFeedback.USEFUL }),
        row({ userId: 'user-B', feedback: InsightFeedback.WRONG }),
      ]);

      const result = await service.getForOrg('org-1');

      const userA = result.byUser.find((b) => b.key === 'user-A')!;
      const userB = result.byUser.find((b) => b.key === 'user-B')!;
      expect(userA.feedbackCounts.USEFUL).toBe(2);
      expect(userB.feedbackCounts.WRONG).toBe(1);
    });

    it('aggregates by relatedActionType', async () => {
      const { service } = makeService([
        row({ relatedActionType: ActionType.INCREASE_BUDGET, feedback: InsightFeedback.USEFUL }),
        row({ relatedActionType: ActionType.INCREASE_BUDGET, feedback: InsightFeedback.WRONG }),
        row({ relatedActionType: ActionType.DECREASE_BUDGET, feedback: InsightFeedback.USEFUL }),
      ]);

      const result = await service.getForOrg('org-1');

      const inc = result.byActionType.find((b) => b.key === 'INCREASE_BUDGET')!;
      const dec = result.byActionType.find((b) => b.key === 'DECREASE_BUDGET')!;
      expect(inc.interactionCount).toBe(2);
      expect(inc.rates.usefulRate).toBe(0.5);
      expect(dec.interactionCount).toBe(1);
    });
  });

  describe('getForOrg — scoping', () => {
    it('filters by orgId — does not leak interactions from another org', async () => {
      const { service, prisma } = makeService([
        row({ orgId: 'org-1', feedback: InsightFeedback.USEFUL }),
        row({ orgId: 'org-2', feedback: InsightFeedback.WRONG }),
      ]);

      const result = await service.getForOrg('org-1');

      expect(prisma.insightInteraction.findMany).toHaveBeenCalledWith({ where: { orgId: 'org-1' } });
      expect(result.totals.interactionCount).toBe(1);
      expect(result.totals.feedbackCounts.WRONG).toBe(0);
      expect(result.totals.feedbackCounts.USEFUL).toBe(1);
    });

    it('returns empty buckets and zero totals when the org has no interactions', async () => {
      const { service } = makeService([]);

      const result = await service.getForOrg('org-empty');

      expect(result.totals.interactionCount).toBe(0);
      expect(result.byInsightType).toHaveLength(0);
      expect(result.byPriority).toHaveLength(0);
      expect(result.byUser).toHaveLength(0);
    });
  });

  describe('getForRules', () => {
    it('groups by relatedRuleId, sorts by interaction volume desc, separates uncategorized', async () => {
      const { service } = makeService([
        row({ relatedRuleId: 'rule-A', feedback: InsightFeedback.USEFUL }),
        row({ relatedRuleId: 'rule-A', feedback: InsightFeedback.USEFUL }),
        row({ relatedRuleId: 'rule-A', feedback: InsightFeedback.WRONG }),
        row({ relatedRuleId: 'rule-B', feedback: InsightFeedback.USEFUL }),
        row({ relatedRuleId: null, feedback: InsightFeedback.NOT_USEFUL }), // trend insight
        row({ relatedRuleId: null, status: InsightInteractionStatus.DISMISSED }),
      ]);

      const result = await service.getForRules('org-1');

      expect(result.rules).toHaveLength(2);
      expect(result.rules[0].ruleId).toBe('rule-A'); // larger bucket first
      expect(result.rules[0].rates.usefulRate).toBeCloseTo(2 / 3, 4);
      expect(result.rules[0].rates.wrongRate).toBeCloseTo(1 / 3, 4);
      expect(result.rules[1].ruleId).toBe('rule-B');
      expect(result.uncategorizedCount).toBe(2);
    });

    it('returns no rules and zero uncategorized when there are no interactions', async () => {
      const { service } = makeService([]);
      const result = await service.getForRules('org-1');
      expect(result.rules).toHaveLength(0);
      expect(result.uncategorizedCount).toBe(0);
    });
  });

  describe('getForAdmin', () => {
    it('aggregates across all orgs and breaks down by orgId', async () => {
      const { service, prisma } = makeService([
        row({ orgId: 'org-1', feedback: InsightFeedback.USEFUL,  insightType: 'OPTIMIZATION_OPPORTUNITY', platform: Platform.META }),
        row({ orgId: 'org-1', feedback: InsightFeedback.WRONG,   insightType: 'OPTIMIZATION_OPPORTUNITY', platform: Platform.META }),
        row({ orgId: 'org-2', feedback: InsightFeedback.USEFUL,  insightType: 'TREND_UP',                  platform: Platform.TIKTOK }),
      ]);

      const result = await service.getForAdmin();

      expect(prisma.insightInteraction.findMany).toHaveBeenCalledWith({});
      expect(result.totals.interactionCount).toBe(3);

      const org1 = result.byOrg.find((b) => b.orgId === 'org-1')!;
      const org2 = result.byOrg.find((b) => b.orgId === 'org-2')!;
      expect(org1.interactionCount).toBe(2);
      expect(org1.feedbackCounts.WRONG).toBe(1);
      expect(org2.interactionCount).toBe(1);

      // Cross-org dimensions still work.
      const meta = result.byPlatform.find((b) => b.key === 'META')!;
      expect(meta.interactionCount).toBe(2);
    });
  });
});
