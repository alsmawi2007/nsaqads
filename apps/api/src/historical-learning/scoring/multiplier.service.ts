import { Injectable, Logger } from '@nestjs/common';
import {
  CampaignGoal,
  FeatureConfidence,
  FunnelStage,
  OrgFeature,
  Platform,
  ScoringSkippedReason,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalizeDimensions } from '../dimensions';
import {
  HLL_FEATURE_REGISTRY,
  getFeatureSpec,
} from '../registry/feature-registry';
import {
  MultiplierContribution,
  MultiplierResult,
} from '../types';

const MULTIPLIER_FLOOR = 0.5;
const MULTIPLIER_CEILING = 2.0;
const NEUTRAL = 1.0;

const FRESHNESS_THRESHOLD_HOURS = 30 * 24; // a row older than 30 days is rejected as STALE

const CONFIDENCE_WEIGHTS: Record<FeatureConfidence, number> = {
  HIGH: 1.0,
  MEDIUM: 0.5,
  LOW: 0.2,
  WARM_START: 0.1,
  INSUFFICIENT: 0,
};

// Subset of features used to score the platform-fitness multiplier in Phase 1.
// Other registry features are computed but not yet wired into scoring.
const SCORING_FEATURES = [
  'platform_roas',
  'platform_cpa',
  'platform_ctr',
  'platform_conversion_rate',
];

const SCORING_WINDOW_DAYS = 30;

export interface MultiplierContext {
  orgId: string;
  platform: Platform;
  goal: CampaignGoal;
  funnelStage: FunnelStage;
  now: Date;
}

@Injectable()
export class MultiplierService {
  private readonly logger = new Logger(MultiplierService.name);

  constructor(private prisma: PrismaService) {}

  // Computes a (clamped) multiplier in [0.5, 2.0] from the org's historical
  // feature rows. Returns NEUTRAL with skippedReason set when any safety
  // check fails — never throws. The caller is responsible for logging the
  // returned MultiplierResult to platform_scoring_decisions.
  async compute(ctx: MultiplierContext): Promise<MultiplierResult> {
    const rows = await this.loadFeatureRows(ctx);

    if (rows.length === 0) {
      return this.neutral('LOW_SAMPLE');
    }

    const contributions: MultiplierContribution[] = [];
    let weightedSum = 0;
    let totalWeight = 0;
    const skipped: ScoringSkippedReason[] = [];
    const summary = { high: 0, medium: 0, low: 0, warmStart: 0 };

    for (const row of rows) {
      const reason = this.checkRowSafety(row, ctx.now);
      if (reason !== null) {
        skipped.push(reason);
        continue;
      }

      const value = Number(row.value);
      const weight = CONFIDENCE_WEIGHTS[row.confidence];
      if (weight === 0) {
        skipped.push('INSUFFICIENT_CONF');
        continue;
      }

      const normalized = this.normalizeFeatureValue(row.featureName, value);
      weightedSum += normalized * weight;
      totalWeight += weight;

      if (row.confidence === 'HIGH') summary.high++;
      else if (row.confidence === 'MEDIUM') summary.medium++;
      else if (row.confidence === 'LOW') summary.low++;
      else if (row.confidence === 'WARM_START') summary.warmStart++;

      contributions.push({
        featureName: row.featureName,
        featureVersion: row.featureVersion,
        windowDays: row.windowDays,
        value,
        weight,
        confidence: row.confidence,
      });
    }

    if (totalWeight === 0) {
      const reason = skipped[0] ?? 'INSUFFICIENT_CONF';
      return this.neutral(reason);
    }

    const raw = weightedSum / totalWeight;
    const clampedValue = Math.max(MULTIPLIER_FLOOR, Math.min(MULTIPLIER_CEILING, raw));
    const clamped = clampedValue !== raw;

    return {
      multiplier: round4(clampedValue),
      clamped,
      contributions,
      skippedReason: null,
      confidenceSummary: summary,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async loadFeatureRows(ctx: MultiplierContext): Promise<OrgFeature[]> {
    const dimensionsKey = canonicalizeDimensions(
      {
        platform: ctx.platform,
        goal: ctx.goal,
        funnel_stage: legacyFunnelToOutcome(ctx.funnelStage),
      },
      ['platform', 'goal', 'funnel_stage'],
    ).dimensionsKey;

    // Funnel-aware features (roas, cpa, conversion_rate) live at full key;
    // platform-only features (ctr) live at a shorter key. Try both.
    const platformOnlyKey = canonicalizeDimensions(
      { platform: ctx.platform, goal: ctx.goal },
      ['platform', 'goal'],
    ).dimensionsKey;

    const candidateKeys = [dimensionsKey, platformOnlyKey];

    return this.prisma.orgFeature.findMany({
      where: {
        orgId: ctx.orgId,
        featureName: { in: SCORING_FEATURES },
        windowDays: SCORING_WINDOW_DAYS,
        dimensionsKey: { in: candidateKeys },
      },
    });
  }

  private checkRowSafety(row: OrgFeature, now: Date): ScoringSkippedReason | null {
    if (row.value === null) return 'NULL_FEATURE';

    const spec = getFeatureSpec(row.featureName);
    if (!spec) return 'BAD_VALUE';

    if (spec.version !== row.featureVersion) {
      // A version mismatch means the registry was bumped but the worker hasn't
      // recomputed yet. Treat as stale rather than trusting old math.
      return 'STALE';
    }

    const numeric = Number(row.value);
    if (!Number.isFinite(numeric)) return 'BAD_VALUE';
    if (numeric < spec.valueRange.min || numeric > spec.valueRange.max) return 'BAD_VALUE';

    if (row.isStale) return 'STALE';

    const ageHours = (now.getTime() - row.computedAt.getTime()) / 3_600_000;
    if (ageHours > FRESHNESS_THRESHOLD_HOURS) return 'STALE_INGESTION';

    if (row.sampleSize < spec.minSampleForLow && !row.isWarmStart) {
      return 'LOW_SAMPLE';
    }

    if (row.confidence === 'INSUFFICIENT') return 'INSUFFICIENT_CONF';

    if (row.isWarmStart && row.sampleSize === 0 && row.value === null) {
      return 'WARM_START_INVALID';
    }

    return null;
  }

  // Maps each feature's raw value into a [0.5, 2.0]-friendly fitness ratio.
  // For "higher is better" features (roas, ctr, conv_rate) we use value/expected.
  // For "lower is better" features (cpa) we use expected/value.
  // The expected baselines below are conservative neutral anchors; they exist
  // here, not in the registry, because they are scoring-side concerns.
  private normalizeFeatureValue(featureName: string, value: number): number {
    if (value <= 0) return NEUTRAL;
    switch (featureName) {
      case 'platform_roas':
        return clip(value / 2.0, 0.5, 2.0);
      case 'platform_cpa':
        return clip(50 / value, 0.5, 2.0);
      case 'platform_ctr':
        return clip(value / 0.01, 0.5, 2.0);
      case 'platform_conversion_rate':
        return clip(value / 0.02, 0.5, 2.0);
      default:
        return NEUTRAL;
    }
  }

  private neutral(reason: ScoringSkippedReason): MultiplierResult {
    return {
      multiplier: NEUTRAL,
      clamped: false,
      contributions: [],
      skippedReason: reason,
      confidenceSummary: { high: 0, medium: 0, low: 0, warmStart: 0 },
    };
  }

  // Used by tests and debug endpoints — exposes the registry-side scoring set.
  getScoringFeatureNames(): string[] {
    return SCORING_FEATURES.filter((n) => HLL_FEATURE_REGISTRY.some((f) => f.name === n));
  }
}

function legacyFunnelToOutcome(stage: FunnelStage): string {
  switch (stage) {
    case 'TOFU':
      return 'TOF';
    case 'MOFU':
      return 'MOF';
    case 'BOFU':
      return 'BOF';
  }
}

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
