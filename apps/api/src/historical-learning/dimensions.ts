import { FeatureDimensionKey, FeatureDimensions } from './types';

// Canonical key order — never reorder. Adding a new key at the end is safe;
// reordering or inserting in the middle silently invalidates all historical rows.
export const DIMENSION_KEY_ORDER: ReadonlyArray<FeatureDimensionKey> = [
  'platform',
  'goal',
  'funnel_stage',
  'audience_type',
  'creative_type',
  'language',
  'vertical',
  'geo_country',
];

const NULL_TOKEN = '_';

// Produces a deterministic string for the unique constraint on org_features.
// Any dimension absent from the input is recorded as NULL_TOKEN so two
// otherwise-equal rows that differ only in whether geo_country is present
// remain distinct.
export function canonicalizeDimensions(
  dims: FeatureDimensions,
  allowedKeys: ReadonlyArray<FeatureDimensionKey>,
): { dimensionsJson: Record<string, string>; dimensionsKey: string } {
  const json: Record<string, string> = {};
  const parts: string[] = [];

  for (const key of DIMENSION_KEY_ORDER) {
    if (!allowedKeys.includes(key)) continue;
    const raw = dims[key];
    if (raw === undefined || raw === null || raw === '') {
      parts.push(`${key}=${NULL_TOKEN}`);
      continue;
    }
    const norm = String(raw).toUpperCase().replace(/\s+/g, '_');
    json[key] = norm;
    parts.push(`${key}=${norm}`);
  }

  return { dimensionsJson: json, dimensionsKey: parts.join('|') };
}
