import {
  CampaignGoal,
  FeatureConfidence,
  FunnelStage,
  OutcomeAudienceType,
  OutcomeCreativeType,
  OutcomeFunnelStage,
  OutcomeLanguage,
  Platform,
  SampleSizeBand,
  ScoringSkippedReason,
} from '@prisma/client';

// ─── Sample-size bands (compile-time floors used by registry + worker) ──────

export const SAMPLE_SIZE_FLOORS = {
  HIGH: 30,
  MEDIUM: 10,
  LOW: 3,
} as const;

export function bandForSampleSize(n: number): SampleSizeBand {
  if (n >= SAMPLE_SIZE_FLOORS.HIGH) return 'HIGH';
  if (n >= SAMPLE_SIZE_FLOORS.MEDIUM) return 'MEDIUM';
  if (n >= SAMPLE_SIZE_FLOORS.LOW) return 'LOW';
  return 'INSUFFICIENT';
}

export function confidenceForBand(
  band: SampleSizeBand,
  isWarmStart: boolean,
): FeatureConfidence {
  if (isWarmStart) return 'WARM_START';
  if (band === 'HIGH') return 'HIGH';
  if (band === 'MEDIUM') return 'MEDIUM';
  if (band === 'LOW') return 'LOW';
  return 'INSUFFICIENT';
}

// ─── Feature Registry contracts ──────────────────────────────────────────────

export type FeatureDimensionKey =
  | 'platform'
  | 'goal'
  | 'funnel_stage'
  | 'audience_type'
  | 'creative_type'
  | 'language'
  | 'vertical'
  | 'geo_country';

export type FeatureDimensions = Partial<Record<FeatureDimensionKey, string>>;

export interface FeatureSpec {
  // Stable feature name; must be unique. Bumping `version` is the only way to
  // change how a value is computed without breaking historical comparisons.
  readonly name: string;
  readonly version: number;
  readonly description: string;

  // Dimensions this feature is computed per. Order matters for the canonical
  // dimensionsKey produced by canonicalizeDimensions().
  readonly dimensions: ReadonlyArray<FeatureDimensionKey>;

  // Rolling windows in days. Multiple rows are produced per (feature × window).
  readonly windowDays: ReadonlyArray<number>;

  // Pointer to the markdown formula doc — kept short on purpose.
  readonly formulaRef: string;

  // Sanity bounds — values outside [min, max] are flagged BAD_VALUE and
  // refused by the multiplier safety check at scoring time.
  readonly valueRange: { min: number; max: number };

  // Compile-time minimum sample size. A feature row with sampleSize below this
  // is INSUFFICIENT and never contributes to a multiplier (warm-start aside).
  readonly minSampleForLow: number;
}

// ─── Multiplier safety result ────────────────────────────────────────────────

export interface MultiplierContribution {
  featureName: string;
  featureVersion: number;
  windowDays: number;
  value: number;
  weight: number;
  confidence: FeatureConfidence;
}

export interface MultiplierResult {
  multiplier: number;
  clamped: boolean;
  contributions: MultiplierContribution[];
  skippedReason: ScoringSkippedReason | null;
  confidenceSummary: {
    high: number;
    medium: number;
    low: number;
    warmStart: number;
  };
}

// ─── Outcome dimension classification ────────────────────────────────────────

export interface OutcomeDimensions {
  platform: Platform;
  goal: CampaignGoal;
  legacyFunnelStage: FunnelStage;
  funnelStage: OutcomeFunnelStage;
  audienceType: OutcomeAudienceType;
  creativeType: OutcomeCreativeType;
  language: OutcomeLanguage;
  vertical: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
}

// ─── Health snapshot ─────────────────────────────────────────────────────────

export interface FeatureHealthSnapshot {
  totalRows: number;
  staleRows: number;
  warmStartRows: number;
  bandBreakdown: Record<SampleSizeBand, number>;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}
