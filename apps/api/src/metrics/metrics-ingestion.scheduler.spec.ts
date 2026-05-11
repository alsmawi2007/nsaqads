import { MetricsIngestionScheduler } from './metrics-ingestion.scheduler';

function makeScheduler(opts: {
  enabled?: boolean;
  intervalHours?: number;
  lastRun?: { createdAt: Date } | null;
  runImpl?: () => Promise<unknown>;
}) {
  const settings = {
    get: jest.fn((key: string) => {
      if (key === 'metrics.ingestion_enabled') return Promise.resolve(opts.enabled ?? true);
      if (key === 'metrics.ingestion_interval_hours') return Promise.resolve(opts.intervalHours ?? 6);
      return Promise.resolve(undefined);
    }),
  };

  const prisma = {
    auditLog: {
      findFirst: jest.fn(() => Promise.resolve(opts.lastRun ?? null)),
    },
  };

  const runner = {
    ingestForAllOrgs: jest.fn(opts.runImpl ?? (() => Promise.resolve({
      runId: 'r1', orgIds: [], totalEntities: 0, succeededCount: 0, failedCount: 0, durationMs: 0,
    }))),
  };

  const scheduler = new MetricsIngestionScheduler(
    prisma as unknown as ConstructorParameters<typeof MetricsIngestionScheduler>[0],
    settings as unknown as ConstructorParameters<typeof MetricsIngestionScheduler>[1],
    runner as unknown as ConstructorParameters<typeof MetricsIngestionScheduler>[2],
  );
  return { scheduler, settings, prisma, runner };
}

describe('MetricsIngestionScheduler', () => {
  it('skips the cycle when ingestion is globally disabled', async () => {
    const { scheduler, runner, prisma } = makeScheduler({ enabled: false });

    await scheduler.handleCron();

    expect(runner.ingestForAllOrgs).not.toHaveBeenCalled();
    expect(prisma.auditLog.findFirst).not.toHaveBeenCalled();
  });

  it('runs immediately when no prior run exists', async () => {
    const { scheduler, runner } = makeScheduler({ enabled: true, lastRun: null });

    await scheduler.handleCron();

    expect(runner.ingestForAllOrgs).toHaveBeenCalledWith({ triggeredBy: 'SCHEDULER' });
  });

  it('skips when the most recent run is younger than intervalHours', async () => {
    const recent = { createdAt: new Date(Date.now() - 60 * 60 * 1000) }; // 1h ago
    const { scheduler, runner } = makeScheduler({ enabled: true, intervalHours: 6, lastRun: recent });

    await scheduler.handleCron();

    expect(runner.ingestForAllOrgs).not.toHaveBeenCalled();
  });

  it('runs when the most recent run is older than intervalHours', async () => {
    const old = { createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000) }; // 8h ago
    const { scheduler, runner } = makeScheduler({ enabled: true, intervalHours: 6, lastRun: old });

    await scheduler.handleCron();

    expect(runner.ingestForAllOrgs).toHaveBeenCalledTimes(1);
  });

  it('swallows runner errors so the cron does not crash', async () => {
    const old = { createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    const { scheduler } = makeScheduler({
      enabled: true,
      lastRun: old,
      runImpl: () => Promise.reject(new Error('provider down')),
    });

    await expect(scheduler.handleCron()).resolves.toBeUndefined();
  });
});
