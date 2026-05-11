import { Platform } from '@prisma/client';
import {
  MetricsIngestionRunnerService,
  aggregatePerPlatform,
} from './metrics-ingestion-runner.service';
import { MetricsIngestionEntityResultDto } from './dto/ingestion-run.dto';

// ─── Test fixtures ───────────────────────────────────────────────────────────

function campaign(overrides: Partial<{ id: string; orgId: string; adAccountId: string; platform: Platform; externalId: string; objective: string | null }> = {}) {
  return {
    id: overrides.id ?? 'camp-1',
    orgId: overrides.orgId ?? 'org-1',
    adAccountId: overrides.adAccountId ?? 'acc-1',
    platform: overrides.platform ?? 'META',
    externalId: overrides.externalId ?? 'ext-1',
    objective: overrides.objective ?? 'CONVERSIONS',
  };
}

function makeService(opts: {
  campaignsByOrg: Record<string, ReturnType<typeof campaign>[]>;
  ingestImpl?: (orgId: string, adAccountId: string, platform: Platform, entityType: 'CAMPAIGN' | 'AD_SET', externalId: string, entityId: string, objective?: string) => Promise<void>;
  orgIds?: string[];
}) {
  const prisma = {
    campaign: {
      findMany: jest.fn(({ where }: { where: { orgId: string } }) =>
        Promise.resolve(opts.campaignsByOrg[where.orgId] ?? []),
      ),
    },
    organization: {
      findMany: jest.fn(() => Promise.resolve((opts.orgIds ?? []).map((id) => ({ id })))),
    },
  };

  const audit = { log: jest.fn(() => Promise.resolve()) };

  const ingestion = {
    ingestForEntity: jest.fn(opts.ingestImpl ?? (() => Promise.resolve())),
  };

  const svc = new MetricsIngestionRunnerService(
    prisma as unknown as ConstructorParameters<typeof MetricsIngestionRunnerService>[0],
    audit as unknown as ConstructorParameters<typeof MetricsIngestionRunnerService>[1],
    ingestion as unknown as ConstructorParameters<typeof MetricsIngestionRunnerService>[2],
  );
  return { svc, prisma, audit, ingestion };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MetricsIngestionRunnerService', () => {
  describe('ingestForOrg', () => {
    it('iterates every campaign in the org and reports per-entity results', async () => {
      const { svc, ingestion } = makeService({
        campaignsByOrg: {
          'org-1': [
            campaign({ id: 'c1', externalId: 'e1' }),
            campaign({ id: 'c2', externalId: 'e2', platform: 'TIKTOK' }),
          ],
        },
      });

      const result = await svc.ingestForOrg('org-1', { triggeredBy: 'MANUAL', userId: 'u1' });

      expect(result.totalEntities).toBe(2);
      expect(result.succeededCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.triggeredBy).toBe('MANUAL');
      expect(result.dryRun).toBe(false);
      expect(result.orgIds).toEqual(['org-1']);
      expect(ingestion.ingestForEntity).toHaveBeenCalledTimes(2);
      expect(ingestion.ingestForEntity).toHaveBeenCalledWith('org-1', 'acc-1', 'META', 'CAMPAIGN', 'e1', 'c1', 'CONVERSIONS');
    });

    it('records partial failures without throwing', async () => {
      const { svc, ingestion } = makeService({
        campaignsByOrg: {
          'org-1': [
            campaign({ id: 'c1', externalId: 'e1' }),
            campaign({ id: 'c2', externalId: 'e2' }),
          ],
        },
        ingestImpl: (_orgId, _acc, _plat, _et, externalId) => {
          if (externalId === 'e2') return Promise.reject(new Error('Provider 500'));
          return Promise.resolve();
        },
      });

      const result = await svc.ingestForOrg('org-1', { triggeredBy: 'MANUAL' });

      expect(result.totalEntities).toBe(2);
      expect(result.succeededCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.entities.find((e) => e.entityId === 'c2')?.errorMessage).toBe('Provider 500');
      expect(ingestion.ingestForEntity).toHaveBeenCalledTimes(2);
    });

    it('skips provider calls in dry run mode', async () => {
      const { svc, ingestion } = makeService({
        campaignsByOrg: { 'org-1': [campaign({ id: 'c1' })] },
      });

      const result = await svc.ingestForOrg('org-1', { triggeredBy: 'MANUAL', dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.totalEntities).toBe(1);
      expect(result.entities[0].succeeded).toBe(true);
      expect(result.entities[0].durationMs).toBe(0);
      expect(ingestion.ingestForEntity).not.toHaveBeenCalled();
    });

    it('writes a single audit log entry summarizing the run', async () => {
      const { svc, audit } = makeService({
        campaignsByOrg: { 'org-1': [campaign({ id: 'c1' })] },
      });

      await svc.ingestForOrg('org-1', { triggeredBy: 'MANUAL', userId: 'u1', note: 'first run' });

      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = (audit.log as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(entry.action).toBe('metrics.ingest.run');
      expect(entry.resourceType).toBe('MetricsIngestion');
      expect(entry.orgId).toBe('org-1');
      expect(entry.userId).toBe('u1');
      const after = entry.afterState as Record<string, unknown>;
      expect(after.note).toBe('first run');
      expect(after.totalEntities).toBe(1);
      expect(after.succeededCount).toBe(1);
    });

    it('caps the audit "errors" array at 50 even when more failures occurred', async () => {
      const campaigns = Array.from({ length: 75 }, (_v, i) =>
        campaign({ id: `c${i}`, externalId: `e${i}` }),
      );
      const { svc, audit } = makeService({
        campaignsByOrg: { 'org-1': campaigns },
        ingestImpl: () => Promise.reject(new Error('boom')),
      });

      await svc.ingestForOrg('org-1', { triggeredBy: 'MANUAL' });

      const entry = (audit.log as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      const after = entry.afterState as { failedCount: number; errors: unknown[] };
      expect(after.failedCount).toBe(75);
      expect(after.errors.length).toBe(50);
    });
  });

  describe('ingestForAllOrgs', () => {
    it('iterates every active org returned by findMany', async () => {
      const { svc, prisma, ingestion } = makeService({
        orgIds: ['org-1', 'org-2'],
        campaignsByOrg: {
          'org-1': [campaign({ id: 'c1', orgId: 'org-1' })],
          'org-2': [campaign({ id: 'c2', orgId: 'org-2', platform: 'TIKTOK' })],
        },
      });

      const result = await svc.ingestForAllOrgs({ triggeredBy: 'SCHEDULER' });

      expect(result.orgIds).toEqual(['org-1', 'org-2']);
      expect(result.totalEntities).toBe(2);
      expect(prisma.organization.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { id: true },
      });
      expect(ingestion.ingestForEntity).toHaveBeenCalledTimes(2);
    });

    it('does not stamp orgId on the audit row when more than one org is in scope', async () => {
      const { svc, audit } = makeService({
        orgIds: ['org-1', 'org-2'],
        campaignsByOrg: { 'org-1': [campaign()], 'org-2': [] },
      });

      await svc.ingestForAllOrgs({ triggeredBy: 'SCHEDULER' });

      const entry = (audit.log as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(entry.orgId).toBeUndefined();
    });
  });

  describe('aggregatePerPlatform', () => {
    it('groups entities by platform and counts ok/failed per group', () => {
      const entities: MetricsIngestionEntityResultDto[] = [
        { orgId: 'o', adAccountId: 'a', platform: 'META', entityType: 'CAMPAIGN', entityId: '1', externalId: 'e1', succeeded: true, errorMessage: null, durationMs: 0 },
        { orgId: 'o', adAccountId: 'a', platform: 'META', entityType: 'CAMPAIGN', entityId: '2', externalId: 'e2', succeeded: false, errorMessage: 'x', durationMs: 0 },
        { orgId: 'o', adAccountId: 'a', platform: 'TIKTOK', entityType: 'CAMPAIGN', entityId: '3', externalId: 'e3', succeeded: true, errorMessage: null, durationMs: 0 },
      ];

      const breakdown = aggregatePerPlatform(entities);

      const meta = breakdown.find((b) => b.platform === 'META');
      const tiktok = breakdown.find((b) => b.platform === 'TIKTOK');
      expect(meta).toEqual({ platform: 'META', totalEntities: 2, succeededCount: 1, failedCount: 1 });
      expect(tiktok).toEqual({ platform: 'TIKTOK', totalEntities: 1, succeededCount: 1, failedCount: 0 });
    });

    it('returns an empty array for no entities', () => {
      expect(aggregatePerPlatform([])).toEqual([]);
    });
  });
});
