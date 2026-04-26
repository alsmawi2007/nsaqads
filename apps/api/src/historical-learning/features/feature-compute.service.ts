import { Injectable, Logger } from '@nestjs/common';
import {
  CampaignOutcome,
  FeatureComputeRun,
  FeatureRunStatus,
  FeatureRunTrigger,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalizeDimensions } from '../dimensions';
import {
  HLL_FEATURE_REGISTRY,
  getFeatureSpec,
} from '../registry/feature-registry';
import {
  FeatureDimensionKey,
  FeatureDimensions,
  FeatureSpec,
  bandForSampleSize,
  confidenceForBand,
} from '../types';

const WARM_START_FLOOR = 1; // org has at least one outcome → blendable
const WARM_START_CEIL = 10; // at this point the org's own data dominates

@Injectable()
export class FeatureComputeService {
  private readonly logger = new Logger(FeatureComputeService.name);

  constructor(private prisma: PrismaService) {}

  // Computes every registry feature for the given org and writes rows into
  // org_features. Idempotent — uses upsert on the canonical unique key.
  async runForOrg(
    orgId: string,
    trigger: FeatureRunTrigger = FeatureRunTrigger.SCHEDULED,
  ): Promise<FeatureComputeRun> {
    const run = await this.prisma.featureComputeRun.create({
      data: { orgId, trigger, status: FeatureRunStatus.SUCCESS },
    });

    let written = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      for (const spec of HLL_FEATURE_REGISTRY) {
        for (const windowDays of spec.windowDays) {
          const result = await this.computeFeatureForOrg(orgId, spec, windowDays, run.id).catch(
            (err: unknown) => {
              errors.push(`${spec.name}@${windowDays}d: ${err instanceof Error ? err.message : String(err)}`);
              return { written: 0, skipped: 0 };
            },
          );
          written += result.written;
          skipped += result.skipped;
        }
      }
    } finally {
      const status: FeatureRunStatus =
        errors.length === 0
          ? FeatureRunStatus.SUCCESS
          : errors.length === HLL_FEATURE_REGISTRY.length
            ? FeatureRunStatus.FAILED
            : FeatureRunStatus.PARTIAL;
      const finishedAt = new Date();
      await this.prisma.featureComputeRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt,
          durationMs: finishedAt.getTime() - run.startedAt.getTime(),
          featuresWritten: written,
          featuresSkipped: skipped,
          errorMessage: errors.length > 0 ? errors.join('; ').slice(0, 4_000) : null,
        },
      });
    }

    return run;
  }

  // Computes global priors (orgId NULL) — used for warm-start blending.
  async runGlobalPriors(): Promise<FeatureComputeRun> {
    const run = await this.prisma.featureComputeRun.create({
      data: { orgId: null, trigger: FeatureRunTrigger.SCHEDULED, status: FeatureRunStatus.SUCCESS },
    });

    let written = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      for (const spec of HLL_FEATURE_REGISTRY) {
        for (const windowDays of spec.windowDays) {
          const result = await this.computeFeatureForOrg(null, spec, windowDays, run.id).catch(
            (err: unknown) => {
              errors.push(`${spec.name}@${windowDays}d: ${err instanceof Error ? err.message : String(err)}`);
              return { written: 0, skipped: 0 };
            },
          );
          written += result.written;
          skipped += result.skipped;
        }
      }
    } finally {
      const status: FeatureRunStatus =
        errors.length === 0 ? FeatureRunStatus.SUCCESS : FeatureRunStatus.PARTIAL;
      const finishedAt = new Date();
      await this.prisma.featureComputeRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt,
          durationMs: finishedAt.getTime() - run.startedAt.getTime(),
          featuresWritten: written,
          featuresSkipped: skipped,
          errorMessage: errors.length > 0 ? errors.join('; ').slice(0, 4_000) : null,
        },
      });
    }

    return run;
  }

  // ─── Per-feature computation ───────────────────────────────────────────────

  private async computeFeatureForOrg(
    orgId: string | null,
    spec: FeatureSpec,
    windowDays: number,
    runId: string,
  ): Promise<{ written: number; skipped: number }> {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const outcomes = await this.prisma.campaignOutcome.findMany({
      where: {
        ...(orgId ? { orgId } : {}),
        endedAt: { gte: since },
        dataQuality: { in: ['CLEAN', 'OUTLIER_FILTERED'] },
      },
    });

    if (outcomes.length === 0) {
      return { written: 0, skipped: 0 };
    }

    const buckets = new Map<string, { dims: FeatureDimensions; outcomes: CampaignOutcome[] }>();
    for (const o of outcomes) {
      const dims = pickDimensions(o, spec.dimensions);
      const { dimensionsKey } = canonicalizeDimensions(dims, spec.dimensions);
      const existing = buckets.get(dimensionsKey);
      if (existing) {
        existing.outcomes.push(o);
      } else {
        buckets.set(dimensionsKey, { dims, outcomes: [o] });
      }
    }

    let written = 0;
    let skipped = 0;

    for (const [, bucket] of buckets) {
      const value = computeAggregate(spec.name, bucket.outcomes);
      if (value === null) {
        skipped++;
        continue;
      }
      if (value < spec.valueRange.min || value > spec.valueRange.max) {
        skipped++;
        continue;
      }

      const sampleSize = bucket.outcomes.length;
      const sampleBand = bandForSampleSize(sampleSize);

      const blended =
        orgId !== null && sampleSize < WARM_START_CEIL
          ? await this.blendWithGlobalPrior(orgId, spec, windowDays, bucket.dims, value, sampleSize)
          : { value, isWarmStart: false, blendedSampleSize: sampleSize };

      const confidence = confidenceForBand(sampleBand, blended.isWarmStart);

      const { dimensionsJson, dimensionsKey } = canonicalizeDimensions(bucket.dims, spec.dimensions);

      // Postgres treats NULL as distinct in unique indexes, so we cannot rely
      // on Prisma's compound unique key when orgId is null (global prior).
      // Use findFirst + update/create to keep both code paths safe.
      const existing = await this.prisma.orgFeature.findFirst({
        where: {
          orgId,
          featureName: spec.name,
          featureVersion: spec.version,
          windowDays,
          dimensionsKey,
        },
      });

      const data = {
        dimensions: dimensionsJson as never,
        value: new Prisma.Decimal(blended.value.toFixed(6)),
        sampleSize,
        sampleBand,
        confidence,
        isWarmStart: blended.isWarmStart,
        isStale: false,
        computedAt: new Date(),
        computedFromRunId: runId,
        metadata: { blendedSampleSize: blended.blendedSampleSize } as never,
      };

      if (existing) {
        await this.prisma.orgFeature.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.orgFeature.create({
          data: {
            ...data,
            orgId,
            featureName: spec.name,
            featureVersion: spec.version,
            dimensionsKey,
            windowDays,
          },
        });
      }

      written++;
    }

    return { written, skipped };
  }

  // Linear-shrinkage blending against the global prior at the same dimensions.
  // local_weight = sampleSize / WARM_START_CEIL (clamped [0,1]).
  // blended = local_weight * org_value + (1 - local_weight) * global_value.
  private async blendWithGlobalPrior(
    orgId: string,
    spec: FeatureSpec,
    windowDays: number,
    dims: FeatureDimensions,
    orgValue: number,
    sampleSize: number,
  ): Promise<{ value: number; isWarmStart: boolean; blendedSampleSize: number }> {
    if (sampleSize >= WARM_START_CEIL) {
      return { value: orgValue, isWarmStart: false, blendedSampleSize: sampleSize };
    }
    const { dimensionsKey } = canonicalizeDimensions(dims, spec.dimensions);
    const prior = await this.prisma.orgFeature.findFirst({
      where: {
        orgId: null,
        featureName: spec.name,
        featureVersion: spec.version,
        windowDays,
        dimensionsKey,
        value: { not: null },
      },
    });
    if (!prior || prior.value === null) {
      // No prior available — degrade gracefully to org value with warm-start flag.
      return {
        value: orgValue,
        isWarmStart: sampleSize < WARM_START_CEIL,
        blendedSampleSize: sampleSize,
      };
    }
    const localWeight = Math.max(0, Math.min(1, sampleSize / WARM_START_CEIL));
    const priorValue = Number(prior.value);
    const blended = localWeight * orgValue + (1 - localWeight) * priorValue;
    return {
      value: blended,
      isWarmStart: sampleSize < WARM_START_CEIL && sampleSize >= WARM_START_FLOOR,
      blendedSampleSize: sampleSize + Number(prior.sampleSize),
    };
  }

  // ─── Marking stale ─────────────────────────────────────────────────────────

  // Flags any feature row older than `staleAfterDays` so the multiplier rejects it.
  // Run as part of scheduled rollup to keep stale flags fresh.
  async markStale(staleAfterDays = 35): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000);
    const result = await this.prisma.orgFeature.updateMany({
      where: { computedAt: { lt: cutoff }, isStale: false },
      data: { isStale: true },
    });
    return result.count;
  }
}

// ─── Aggregation formulas ────────────────────────────────────────────────────

function computeAggregate(name: string, rows: CampaignOutcome[]): number | null {
  if (rows.length === 0) return null;
  const totalSpend = sum(rows, (r) => Number(r.spend));
  const totalImpr = sum(rows, (r) => Number(r.impressions));
  const totalClicks = sum(rows, (r) => Number(r.clicks));
  const totalConv = sum(rows, (r) => Number(r.conversions));
  const totalRev = sum(rows, (r) => Number(r.revenue));

  switch (name) {
    case 'platform_roas':
    case 'audience_type_roas':
    case 'vertical_platform_fit':
      return totalSpend > 0 ? totalRev / totalSpend : null;
    case 'platform_cpa':
    case 'geo_efficiency':
      return totalConv > 0 ? totalSpend / totalConv : null;
    case 'platform_ctr':
    case 'creative_type_ctr':
    case 'language_engagement':
      return totalImpr > 0 ? totalClicks / totalImpr : null;
    case 'platform_cpm':
      return totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : null;
    case 'platform_conversion_rate':
      return totalClicks > 0 ? totalConv / totalClicks : null;
    default:
      return null;
  }
}

function pickDimensions(o: CampaignOutcome, keys: ReadonlyArray<FeatureDimensionKey>): FeatureDimensions {
  const out: FeatureDimensions = {};
  for (const k of keys) {
    switch (k) {
      case 'platform': out.platform = o.platform; break;
      case 'goal': out.goal = o.goal; break;
      case 'funnel_stage': out.funnel_stage = o.funnelStage; break;
      case 'audience_type': out.audience_type = o.audienceType; break;
      case 'creative_type': out.creative_type = o.creativeType; break;
      case 'language': out.language = o.language; break;
      case 'vertical': out.vertical = o.vertical ?? undefined; break;
      case 'geo_country': out.geo_country = o.geoCountry ?? undefined; break;
    }
  }
  return out;
}

function sum<T>(items: T[], fn: (x: T) => number): number {
  let total = 0;
  for (const x of items) total += fn(x);
  return total;
}
