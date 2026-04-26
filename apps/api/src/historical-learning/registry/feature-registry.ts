import { FeatureSpec } from '../types';

// ─── HLL Phase 1 — Feature Registry ──────────────────────────────────────────
// This file is the SINGLE SOURCE OF TRUTH for which features exist, their
// dimensions, sanity bounds, and version. The compute worker reads from here.
// The scoring path reads from here. Tests assert registry integrity from here.
//
// Adding a feature: append a new entry. Changing how an existing feature is
// computed: bump its version. Never silently change `dimensions` or `valueRange`.

export const HLL_FEATURE_REGISTRY: ReadonlyArray<FeatureSpec> = [
  {
    name: 'platform_roas',
    version: 1,
    description:
      'Realized ROAS (revenue / spend) for completed campaigns at the (platform × goal × funnel) level.',
    dimensions: ['platform', 'goal', 'funnel_stage'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/platform_roas.md',
    valueRange: { min: 0, max: 50 },
    minSampleForLow: 3,
  },
  {
    name: 'platform_cpa',
    version: 1,
    description:
      'Realized CPA (spend / conversions) for completed campaigns at the (platform × goal × funnel) level.',
    dimensions: ['platform', 'goal', 'funnel_stage'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/platform_cpa.md',
    valueRange: { min: 0, max: 100000 },
    minSampleForLow: 3,
  },
  {
    name: 'platform_ctr',
    version: 1,
    description:
      'Realized CTR (clicks / impressions) for completed campaigns at the (platform × goal) level.',
    dimensions: ['platform', 'goal'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/platform_ctr.md',
    valueRange: { min: 0, max: 1 },
    minSampleForLow: 3,
  },
  {
    name: 'platform_cpm',
    version: 1,
    description:
      'Realized CPM (spend / impressions × 1000) for completed campaigns per (platform × goal).',
    dimensions: ['platform', 'goal'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/platform_cpm.md',
    valueRange: { min: 0, max: 1000 },
    minSampleForLow: 3,
  },
  {
    name: 'platform_conversion_rate',
    version: 1,
    description:
      'Realized conversion rate (conversions / clicks) per (platform × goal × funnel).',
    dimensions: ['platform', 'goal', 'funnel_stage'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/platform_conversion_rate.md',
    valueRange: { min: 0, max: 1 },
    minSampleForLow: 3,
  },
  {
    name: 'audience_type_roas',
    version: 1,
    description:
      'ROAS broken down by audience archetype (cold, lookalike, retargeting) within a platform and goal.',
    dimensions: ['platform', 'goal', 'audience_type'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/audience_type_roas.md',
    valueRange: { min: 0, max: 50 },
    minSampleForLow: 3,
  },
  {
    name: 'creative_type_ctr',
    version: 1,
    description:
      'CTR broken down by creative format (vertical video, static, carousel, etc.) within a platform.',
    dimensions: ['platform', 'creative_type'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/creative_type_ctr.md',
    valueRange: { min: 0, max: 1 },
    minSampleForLow: 3,
  },
  {
    name: 'language_engagement',
    version: 1,
    description:
      'CTR by ad language (AR, EN, AR_EN_MIXED) within a platform — captures Saudi/Gulf market localization signal.',
    dimensions: ['platform', 'language'],
    windowDays: [30, 90],
    formulaRef: 'docs/features/language_engagement.md',
    valueRange: { min: 0, max: 1 },
    minSampleForLow: 3,
  },
  {
    name: 'vertical_platform_fit',
    version: 1,
    description:
      'ROAS at the (vertical × platform) level — answers "which platform wins for this industry within this org".',
    dimensions: ['vertical', 'platform'],
    windowDays: [90],
    formulaRef: 'docs/features/vertical_platform_fit.md',
    valueRange: { min: 0, max: 50 },
    minSampleForLow: 3,
  },
  {
    name: 'geo_efficiency',
    version: 1,
    description:
      'CPA at the (geo_country × platform) level — flags markets where this org historically over- or under-pays.',
    dimensions: ['geo_country', 'platform'],
    windowDays: [90],
    formulaRef: 'docs/features/geo_efficiency.md',
    valueRange: { min: 0, max: 100000 },
    minSampleForLow: 3,
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

const BY_NAME = new Map<string, FeatureSpec>(
  HLL_FEATURE_REGISTRY.map((f) => [f.name, f]),
);

export function getFeatureSpec(name: string): FeatureSpec | undefined {
  return BY_NAME.get(name);
}

export function getFeatureSpecOrThrow(name: string): FeatureSpec {
  const spec = BY_NAME.get(name);
  if (!spec) throw new Error(`Unknown HLL feature: ${name}`);
  return spec;
}

export function listFeatureNames(): string[] {
  return HLL_FEATURE_REGISTRY.map((f) => f.name);
}
