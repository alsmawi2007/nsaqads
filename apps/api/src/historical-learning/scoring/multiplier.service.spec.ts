import { Prisma } from '@prisma/client';
import { MultiplierService } from './multiplier.service';

type Row = {
  featureName: string;
  featureVersion: number;
  windowDays: number;
  value: Prisma.Decimal | null;
  sampleSize: number;
  sampleBand: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' | 'WARM_START';
  isWarmStart: boolean;
  isStale: boolean;
  computedAt: Date;
};

type RowOverrides = Omit<Partial<Row>, 'value'> & { featureName: string; value: number };

function row(overrides: RowOverrides): Row {
  return {
    featureName: overrides.featureName,
    featureVersion: overrides.featureVersion ?? 1,
    windowDays: overrides.windowDays ?? 30,
    value: new Prisma.Decimal(overrides.value),
    sampleSize: overrides.sampleSize ?? 30,
    sampleBand: overrides.sampleBand ?? 'HIGH',
    confidence: overrides.confidence ?? 'HIGH',
    isWarmStart: overrides.isWarmStart ?? false,
    isStale: overrides.isStale ?? false,
    computedAt: overrides.computedAt ?? new Date(),
  };
}

function makeService(rows: Row[]): MultiplierService {
  const prisma = {
    orgFeature: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as ConstructorParameters<typeof MultiplierService>[0];
  return new MultiplierService(prisma);
}

describe('MultiplierService.compute', () => {
  const ctx = {
    orgId: 'o1',
    platform: 'META' as const,
    goal: 'SALES' as const,
    funnelStage: 'BOFU' as const,
    now: new Date(),
  };

  it('returns NEUTRAL when no rows are found', async () => {
    const svc = makeService([]);
    const r = await svc.compute(ctx);
    expect(r.multiplier).toBe(1);
    expect(r.skippedReason).toBe('LOW_SAMPLE');
    expect(r.contributions).toHaveLength(0);
  });

  it('clamps values into [0.5, 2.0]', async () => {
    const svc = makeService([
      row({ featureName: 'platform_roas', value: 100 }), // huge ROAS → would be > 2 unclamped
    ]);
    const r = await svc.compute(ctx);
    expect(r.multiplier).toBeLessThanOrEqual(2.0);
    expect(r.multiplier).toBeGreaterThanOrEqual(0.5);
  });

  it('skips rows whose value is outside the registry sanity range', async () => {
    const svc = makeService([row({ featureName: 'platform_ctr', value: 5.0 })]); // CTR > 1 is impossible
    const r = await svc.compute(ctx);
    expect(r.skippedReason).toBe('BAD_VALUE');
  });

  it('skips rows whose featureVersion does not match the registry', async () => {
    const stale = row({ featureName: 'platform_roas', value: 2 });
    stale.featureVersion = 99;
    const svc = makeService([stale]);
    const r = await svc.compute(ctx);
    expect(r.skippedReason).toBe('STALE');
  });

  it('rejects null-valued rows', async () => {
    const r = row({ featureName: 'platform_roas', value: 0 });
    r.value = null;
    const svc = makeService([r]);
    const result = await svc.compute(ctx);
    expect(result.skippedReason).toBe('NULL_FEATURE');
  });
});
