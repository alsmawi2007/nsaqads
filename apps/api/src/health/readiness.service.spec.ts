import { ReadinessService } from './readiness.service';

interface Fixture {
  providerConfigs?: { platform: string; isEnabled: boolean }[];
  adAccounts?: { status: string; lastSyncedAt: Date | null }[];
  latestSnapshot?: { createdAt: Date } | null;
  snapshotCount?: number;
  ruleCount?: number;
  optimizerActionCount?: number;
  ruleTuningLogCount?: number;
  campaignCounts?: Partial<Record<'AUTO_APPLY' | 'SUGGEST_ONLY' | 'OFF', number>>;
  settings?: Partial<Record<string, unknown>>;
  settingsThrowKeys?: string[];
}

function makeService(fx: Fixture = {}) {
  const counts = fx.campaignCounts ?? {};
  const prisma = {
    providerConfig: { findMany: jest.fn(() => Promise.resolve(fx.providerConfigs ?? [])) },
    adAccount: { findMany: jest.fn(() => Promise.resolve(fx.adAccounts ?? [])) },
    metricSnapshot: {
      findFirst: jest.fn(() => Promise.resolve(fx.latestSnapshot ?? null)),
      count: jest.fn(() => Promise.resolve(fx.snapshotCount ?? 0)),
    },
    optimizerRule: { count: jest.fn(() => Promise.resolve(fx.ruleCount ?? 0)) },
    optimizerAction: { count: jest.fn(() => Promise.resolve(fx.optimizerActionCount ?? 0)) },
    ruleTuningLog: { count: jest.fn(() => Promise.resolve(fx.ruleTuningLogCount ?? 0)) },
    campaign: {
      count: jest.fn(({ where }: { where: { optimizerMode: string } }) =>
        Promise.resolve(counts[where.optimizerMode as 'AUTO_APPLY' | 'SUGGEST_ONLY' | 'OFF'] ?? 0),
      ),
    },
  };

  const settings = {
    get: jest.fn((key: string) => {
      if (fx.settingsThrowKeys?.includes(key)) return Promise.reject(new Error('no default'));
      const map = { 'metrics.ingestion_enabled': true, 'metrics.ingestion_interval_hours': 6, ...(fx.settings ?? {}) };
      return Promise.resolve((map as Record<string, unknown>)[key]);
    }),
  };

  return new ReadinessService(
    prisma as unknown as ConstructorParameters<typeof ReadinessService>[0],
    settings as unknown as ConstructorParameters<typeof ReadinessService>[1],
  );
}

describe('ReadinessService', () => {
  describe('status classification', () => {
    it('returns "ready" with no blockers when every pillar is healthy', async () => {
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [{ status: 'ACTIVE', lastSyncedAt: new Date() }],
        latestSnapshot: { createdAt: new Date() },
        snapshotCount: 36,
        campaignCounts: { SUGGEST_ONLY: 12 },
      });

      const r = await svc.getReadiness();

      expect(r.status).toBe('ready');
      expect(r.blockers).toEqual([]);
      expect(r.guardrails.rolloutSafetyOk).toBe(true);
    });

    it('returns "unsafe" when auto-tune is enabled', async () => {
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [{ status: 'ACTIVE', lastSyncedAt: new Date() }],
        latestSnapshot: { createdAt: new Date() },
        settings: { 'learning.auto_tune_enabled': true },
        campaignCounts: { SUGGEST_ONLY: 5 },
      });

      const r = await svc.getReadiness();

      expect(r.status).toBe('unsafe');
      expect(r.guardrails.autoTuneEnabled).toBe(true);
      expect(r.blockers.some((b) => b.startsWith('UNSAFE: learning.auto_tune_enabled'))).toBe(true);
    });

    it('returns "unsafe" when any campaign is on AUTO_APPLY', async () => {
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [{ status: 'ACTIVE', lastSyncedAt: new Date() }],
        latestSnapshot: { createdAt: new Date() },
        campaignCounts: { AUTO_APPLY: 3, SUGGEST_ONLY: 5 },
      });

      const r = await svc.getReadiness();

      expect(r.status).toBe('unsafe');
      expect(r.guardrails.autoApplyCampaignCount).toBe(3);
      expect(r.blockers.some((b) => b.includes('AUTO_APPLY'))).toBe(true);
    });

    it('returns "degraded" when no provider is enabled but guardrails hold', async () => {
      const svc = makeService({ providerConfigs: [], campaignCounts: { SUGGEST_ONLY: 0 } });

      const r = await svc.getReadiness();

      expect(r.status).toBe('degraded');
      expect(r.guardrails.rolloutSafetyOk).toBe(true);
      expect(r.blockers).toContain('No provider config is enabled — Meta must be enabled before OAuth.');
    });

    it('flags missing ingestion data as a degraded blocker', async () => {
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [{ status: 'ACTIVE', lastSyncedAt: new Date() }],
        latestSnapshot: null,
      });

      const r = await svc.getReadiness();

      expect(r.status).toBe('degraded');
      expect(r.blockers).toContain('No metrics ingested yet — run POST /admin/metrics/ingest/run.');
    });
  });

  describe('pillars', () => {
    it('reports provider configs and enabled platforms', async () => {
      const svc = makeService({
        providerConfigs: [
          { platform: 'META', isEnabled: true },
          { platform: 'TIKTOK', isEnabled: false },
          { platform: 'SNAPCHAT', isEnabled: true },
        ],
      });

      const r = await svc.getReadiness();

      expect(r.providerConfigs.configured).toBe(3);
      expect(r.providerConfigs.enabled).toBe(2);
      expect(r.providerConfigs.enabledPlatforms.sort()).toEqual(['META', 'SNAPCHAT']);
    });

    it('reports ad-account status counts and freshest sync', async () => {
      const newer = new Date(Date.now() - 5 * 60_000); // 5m ago
      const older = new Date(Date.now() - 60 * 60_000); // 1h ago
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [
          { status: 'ACTIVE', lastSyncedAt: older },
          { status: 'ACTIVE', lastSyncedAt: newer },
          { status: 'ERROR', lastSyncedAt: null },
          { status: 'DISCONNECTED', lastSyncedAt: null },
        ],
        latestSnapshot: { createdAt: new Date() },
      });

      const r = await svc.getReadiness();

      expect(r.adAccounts.total).toBe(4);
      expect(r.adAccounts.active).toBe(2);
      expect(r.adAccounts.errored).toBe(1);
      expect(r.adAccounts.disconnected).toBe(1);
      expect(r.adAccounts.lastSyncedAt).toBe(newer.toISOString());
      expect(r.adAccounts.minutesSinceLastSync).toBeLessThan(10);
    });

    it('falls back to false when learning.auto_tune_enabled has no compile-time default', async () => {
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [{ status: 'ACTIVE', lastSyncedAt: new Date() }],
        latestSnapshot: { createdAt: new Date() },
        settingsThrowKeys: ['learning.auto_tune_enabled'],
      });

      const r = await svc.getReadiness();

      expect(r.guardrails.autoTuneEnabled).toBe(false);
      expect(r.guardrails.rolloutSafetyOk).toBe(true);
    });

    it('returns null freshness when no ad accounts have synced', async () => {
      const svc = makeService({
        providerConfigs: [{ platform: 'META', isEnabled: true }],
        adAccounts: [{ status: 'ACTIVE', lastSyncedAt: null }],
        latestSnapshot: null,
      });

      const r = await svc.getReadiness();

      expect(r.adAccounts.lastSyncedAt).toBeNull();
      expect(r.adAccounts.minutesSinceLastSync).toBeNull();
      expect(r.ingestion.lastIngestionAt).toBeNull();
    });
  });
});
