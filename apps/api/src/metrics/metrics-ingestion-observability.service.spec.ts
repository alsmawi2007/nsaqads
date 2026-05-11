import { MetricsIngestionObservabilityService } from './metrics-ingestion-observability.service';

interface ObsFixture {
  enabled?: boolean;
  intervalHours?: number;
  auditRows?: { afterState: unknown }[];
  accounts?: { id: string; orgId: string; platform: string; name: string | null }[];
  campaigns?: { id: string; adAccountId: string }[];
  groupBy?: { entityId: string; _max: { createdAt: Date | null } }[];
}

function makeObs(fx: ObsFixture) {
  const settings = {
    get: jest.fn((key: string) => {
      if (key === 'metrics.ingestion_enabled') return Promise.resolve(fx.enabled ?? true);
      if (key === 'metrics.ingestion_interval_hours') return Promise.resolve(fx.intervalHours ?? 6);
      return Promise.resolve(undefined);
    }),
  };

  const prisma = {
    auditLog: { findMany: jest.fn(() => Promise.resolve(fx.auditRows ?? [])) },
    adAccount: { findMany: jest.fn(() => Promise.resolve(fx.accounts ?? [])) },
    campaign: { findMany: jest.fn(() => Promise.resolve(fx.campaigns ?? [])) },
    metricSnapshot: { groupBy: jest.fn(() => Promise.resolve(fx.groupBy ?? [])) },
  };

  const svc = new MetricsIngestionObservabilityService(
    prisma as unknown as ConstructorParameters<typeof MetricsIngestionObservabilityService>[0],
    settings as unknown as ConstructorParameters<typeof MetricsIngestionObservabilityService>[1],
  );
  return { svc, prisma, settings };
}

describe('MetricsIngestionObservabilityService', () => {
  it('returns the AdminSetting flag and interval', async () => {
    const { svc } = makeObs({ enabled: false, intervalHours: 12 });

    const obs = await svc.getObservability();

    expect(obs.ingestionEnabled).toBe(false);
    expect(obs.intervalHours).toBe(12);
    expect(obs.lastRunAt).toBeNull();
  });

  it('reshapes audit_logs into recent run summaries', async () => {
    const t = '2026-04-30T12:00:00.000Z';
    const { svc } = makeObs({
      auditRows: [
        {
          afterState: {
            runId: 'r-1',
            startedAt: t,
            finishedAt: t,
            durationMs: 4200,
            triggeredBy: 'MANUAL',
            dryRun: false,
            totalEntities: 5,
            succeededCount: 4,
            failedCount: 1,
            orgIds: ['o-1'],
          },
        },
      ],
    });

    const obs = await svc.getObservability();

    expect(obs.recentRuns).toHaveLength(1);
    expect(obs.recentRuns[0].runId).toBe('r-1');
    expect(obs.recentRuns[0].durationMs).toBe(4200);
    expect(obs.recentRuns[0].triggeredBy).toBe('MANUAL');
    expect(obs.lastRunAt).toBe(t);
  });

  it('drops malformed audit rows defensively', async () => {
    const { svc } = makeObs({
      auditRows: [
        { afterState: null },
        { afterState: 'not-an-object' },
        { afterState: { startedAt: '2026-04-30T12:00:00.000Z' /* no runId */ } },
      ],
    });

    const obs = await svc.getObservability();

    expect(obs.recentRuns).toEqual([]);
    expect(obs.lastRunAt).toBeNull();
  });

  it('derives per-account freshness from MAX(metric_snapshots.created_at)', async () => {
    const t = new Date('2026-04-30T10:00:00.000Z');
    const { svc } = makeObs({
      accounts: [{ id: 'acc-1', orgId: 'org-1', platform: 'META', name: 'Acme META' }],
      campaigns: [
        { id: 'c1', adAccountId: 'acc-1' },
        { id: 'c2', adAccountId: 'acc-1' },
      ],
      groupBy: [
        { entityId: 'c1', _max: { createdAt: new Date('2026-04-29T08:00:00.000Z') } },
        { entityId: 'c2', _max: { createdAt: t } }, // later — should win
      ],
    });

    const obs = await svc.getObservability();

    expect(obs.perAccountFreshness).toHaveLength(1);
    const fresh = obs.perAccountFreshness[0];
    expect(fresh.adAccountId).toBe('acc-1');
    expect(fresh.campaignCount).toBe(2);
    expect(fresh.lastIngestedAt).toBe(t.toISOString());
    expect(typeof fresh.minutesSinceLastIngestion).toBe('number');
  });

  it('reports null freshness for accounts with no snapshots', async () => {
    const { svc } = makeObs({
      accounts: [{ id: 'acc-1', orgId: 'org-1', platform: 'META', name: 'Acme META' }],
      campaigns: [{ id: 'c1', adAccountId: 'acc-1' }],
      groupBy: [],
    });

    const obs = await svc.getObservability();

    expect(obs.perAccountFreshness[0].lastIngestedAt).toBeNull();
    expect(obs.perAccountFreshness[0].minutesSinceLastIngestion).toBeNull();
  });

  it('skips the groupBy query when no campaigns exist', async () => {
    const { svc, prisma } = makeObs({
      accounts: [{ id: 'acc-1', orgId: 'org-1', platform: 'META', name: 'Empty acct' }],
      campaigns: [],
    });

    const obs = await svc.getObservability();

    expect(obs.perAccountFreshness[0].campaignCount).toBe(0);
    expect(prisma.metricSnapshot.groupBy).not.toHaveBeenCalled();
  });
});
