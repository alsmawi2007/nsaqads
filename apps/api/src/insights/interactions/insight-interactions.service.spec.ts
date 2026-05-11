import { ActionType, InsightFeedback, InsightInteractionStatus, Platform } from '@prisma/client';
import { InsightInteractionsService } from './insight-interactions.service';
import { PrismaService } from '../../prisma/prisma.service';

interface MockPrisma {
  insightInteraction: {
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
}

function makeService() {
  const prisma: MockPrisma = {
    insightInteraction: {
      findMany: jest.fn(),
      upsert: jest.fn().mockImplementation(({ create, update, where }) =>
        Promise.resolve({
          id: 'int-fake',
          orgId: create.orgId,
          insightId: where.insightId_userId.insightId,
          userId: where.insightId_userId.userId,
          status: update.status ?? create.status ?? null,
          feedback: update.feedback ?? create.feedback ?? null,
          note: update.note ?? create.note ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    },
  };
  const service = new InsightInteractionsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('InsightInteractionsService', () => {
  describe('setStatus', () => {
    it('upserts on the (insightId, userId) compound key with the given status', async () => {
      const { service, prisma } = makeService();

      await service.setStatus('org-1', 'ins_abc', 'user-1', InsightInteractionStatus.SEEN);

      expect(prisma.insightInteraction.upsert).toHaveBeenCalledTimes(1);
      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ insightId_userId: { insightId: 'ins_abc', userId: 'user-1' } });
      expect(args.create).toEqual({
        insightId: 'ins_abc',
        orgId: 'org-1',
        userId: 'user-1',
        status: InsightInteractionStatus.SEEN,
      });
      expect(args.update).toEqual({ status: InsightInteractionStatus.SEEN });
    });

    it('mutates only the status on update, leaving feedback / note untouched', async () => {
      const { service, prisma } = makeService();

      await service.setStatus('org-1', 'ins_abc', 'user-1', InsightInteractionStatus.DISMISSED);

      const update = prisma.insightInteraction.upsert.mock.calls[0][0].update;
      expect(update).not.toHaveProperty('feedback');
      expect(update).not.toHaveProperty('note');
    });
  });

  describe('setFeedback', () => {
    it('upserts with the given feedback verdict and stores note when supplied', async () => {
      const { service, prisma } = makeService();

      await service.setFeedback('org-1', 'ins_abc', 'user-1', InsightFeedback.USEFUL, 'Helpful flag');

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.create).toEqual({
        insightId: 'ins_abc',
        orgId: 'org-1',
        userId: 'user-1',
        feedback: InsightFeedback.USEFUL,
        note: 'Helpful flag',
      });
      expect(args.update).toEqual({ feedback: InsightFeedback.USEFUL, note: 'Helpful flag' });
    });

    it('leaves the prior note intact when note is undefined (omits note from update payload)', async () => {
      const { service, prisma } = makeService();

      await service.setFeedback('org-1', 'ins_abc', 'user-1', InsightFeedback.WRONG);

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.update).toEqual({ feedback: InsightFeedback.WRONG });
      expect(args.update).not.toHaveProperty('note');
      // create still records null so a brand-new row has a defined note column.
      expect(args.create.note).toBeNull();
    });

    it('explicitly clears the note when note is passed as null', async () => {
      const { service, prisma } = makeService();

      await service.setFeedback('org-1', 'ins_abc', 'user-1', InsightFeedback.NEEDS_MORE_CONTEXT, null);

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.update).toEqual({ feedback: InsightFeedback.NEEDS_MORE_CONTEXT, note: null });
    });
  });

  describe('getForOrgUser', () => {
    it('returns a Map keyed by insightId', async () => {
      const { service, prisma } = makeService();
      prisma.insightInteraction.findMany.mockResolvedValue([
        { id: '1', insightId: 'ins_a', orgId: 'org-1', userId: 'user-1', status: 'SEEN', feedback: null, note: null, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', insightId: 'ins_b', orgId: 'org-1', userId: 'user-1', status: 'SAVED', feedback: 'USEFUL', note: 'pin', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const map = await service.getForOrgUser('org-1', 'user-1');

      expect(map.size).toBe(2);
      expect(map.get('ins_a')!.status).toBe('SEEN');
      expect(map.get('ins_b')!.status).toBe('SAVED');
      expect(map.get('ins_b')!.feedback).toBe('USEFUL');
    });

    it('scopes the query to the (orgId, userId) pair', async () => {
      const { service, prisma } = makeService();
      prisma.insightInteraction.findMany.mockResolvedValue([]);

      await service.getForOrgUser('org-7', 'user-99');

      expect(prisma.insightInteraction.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-7', userId: 'user-99' },
      });
    });

    it('returns an empty map when the user has no interactions', async () => {
      const { service, prisma } = makeService();
      prisma.insightInteraction.findMany.mockResolvedValue([]);

      const map = await service.getForOrgUser('org-1', 'user-1');

      expect(map.size).toBe(0);
    });
  });

  describe('metadata capture (Phase F)', () => {
    it('persists provided metadata fields on setStatus create + update', async () => {
      const { service, prisma } = makeService();

      await service.setStatus('org-1', 'ins_abc', 'user-1', InsightInteractionStatus.SAVED, {
        insightType: 'OPTIMIZATION_OPPORTUNITY',
        priority: 'HIGH',
        severity: 'MEDIUM',
        relatedRuleId: 'rule-7',
        relatedActionType: ActionType.INCREASE_BUDGET,
        platform: Platform.META,
        entityType: 'CAMPAIGN',
        entityId: 'camp-1',
      });

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.create.insightType).toBe('OPTIMIZATION_OPPORTUNITY');
      expect(args.create.priority).toBe('HIGH');
      expect(args.create.relatedRuleId).toBe('rule-7');
      expect(args.create.relatedActionType).toBe(ActionType.INCREASE_BUDGET);
      expect(args.create.platform).toBe(Platform.META);
      expect(args.create.entityType).toBe('CAMPAIGN');
      // Update mirrors create so re-marking refreshes the captured metadata.
      expect(args.update.insightType).toBe('OPTIMIZATION_OPPORTUNITY');
      expect(args.update.platform).toBe(Platform.META);
    });

    it('omits metadata keys entirely when the caller passes no metadata', async () => {
      const { service, prisma } = makeService();

      await service.setStatus('org-1', 'ins_abc', 'user-1', InsightInteractionStatus.SEEN);

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.create).not.toHaveProperty('insightType');
      expect(args.create).not.toHaveProperty('relatedRuleId');
      expect(args.update).not.toHaveProperty('platform');
    });

    it('drops only undefined metadata keys but preserves explicit nulls', async () => {
      const { service, prisma } = makeService();

      await service.setStatus('org-1', 'ins_abc', 'user-1', InsightInteractionStatus.SEEN, {
        insightType: 'TREND_DOWN',
        relatedRuleId: null,                  // explicit clear
        relatedActionType: undefined,         // skipped
      });

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.create.insightType).toBe('TREND_DOWN');
      expect(args.create.relatedRuleId).toBeNull();
      expect(args.create).not.toHaveProperty('relatedActionType');
    });

    it('persists metadata on setFeedback the same way', async () => {
      const { service, prisma } = makeService();

      await service.setFeedback('org-1', 'ins_abc', 'user-1', InsightFeedback.USEFUL, 'works for me', {
        insightType: 'PERFORMANCE_RISK',
        platform: Platform.TIKTOK,
        relatedRuleId: 'rule-9',
      });

      const args = prisma.insightInteraction.upsert.mock.calls[0][0];
      expect(args.create.insightType).toBe('PERFORMANCE_RISK');
      expect(args.create.platform).toBe(Platform.TIKTOK);
      expect(args.create.relatedRuleId).toBe('rule-9');
      expect(args.update.insightType).toBe('PERFORMANCE_RISK');
    });
  });
});
