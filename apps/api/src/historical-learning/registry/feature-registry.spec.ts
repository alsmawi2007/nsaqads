import { canonicalizeDimensions } from '../dimensions';
import { bandForSampleSize, confidenceForBand } from '../types';
import {
  HLL_FEATURE_REGISTRY,
  getFeatureSpec,
  getFeatureSpecOrThrow,
  listFeatureNames,
} from './feature-registry';

describe('Feature Registry integrity', () => {
  it('feature names are unique', () => {
    const names = listFeatureNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('every feature declares at least one window and a value range', () => {
    for (const f of HLL_FEATURE_REGISTRY) {
      expect(f.windowDays.length).toBeGreaterThan(0);
      expect(f.valueRange.min).toBeLessThan(f.valueRange.max);
      expect(f.minSampleForLow).toBeGreaterThanOrEqual(1);
      expect(f.dimensions.length).toBeGreaterThan(0);
      expect(f.formulaRef).toMatch(/\.md$/);
    }
  });

  it('lookup helpers behave consistently', () => {
    const first = HLL_FEATURE_REGISTRY[0];
    expect(getFeatureSpec(first.name)).toBe(first);
    expect(getFeatureSpecOrThrow(first.name)).toBe(first);
    expect(getFeatureSpec('does-not-exist')).toBeUndefined();
    expect(() => getFeatureSpecOrThrow('does-not-exist')).toThrow();
  });
});

describe('dimensions canonicalization', () => {
  it('produces a deterministic key independent of insertion order', () => {
    const a = canonicalizeDimensions(
      { goal: 'sales', platform: 'meta' } as never,
      ['platform', 'goal'],
    );
    const b = canonicalizeDimensions(
      { platform: 'META', goal: 'SALES' } as never,
      ['platform', 'goal'],
    );
    expect(a.dimensionsKey).toBe(b.dimensionsKey);
  });

  it('uppercases values and uses NULL token for missing dimensions', () => {
    const result = canonicalizeDimensions({ platform: 'meta' } as never, ['platform', 'goal']);
    expect(result.dimensionsKey).toBe('platform=META|goal=_');
    expect(result.dimensionsJson).toEqual({ platform: 'META' });
  });
});

describe('bandForSampleSize', () => {
  it('maps thresholds to bands', () => {
    expect(bandForSampleSize(0)).toBe('INSUFFICIENT');
    expect(bandForSampleSize(2)).toBe('INSUFFICIENT');
    expect(bandForSampleSize(3)).toBe('LOW');
    expect(bandForSampleSize(9)).toBe('LOW');
    expect(bandForSampleSize(10)).toBe('MEDIUM');
    expect(bandForSampleSize(29)).toBe('MEDIUM');
    expect(bandForSampleSize(30)).toBe('HIGH');
    expect(bandForSampleSize(1000)).toBe('HIGH');
  });

  it('confidenceForBand prefers WARM_START flag over band', () => {
    expect(confidenceForBand('HIGH', false)).toBe('HIGH');
    expect(confidenceForBand('HIGH', true)).toBe('WARM_START');
    expect(confidenceForBand('INSUFFICIENT', false)).toBe('INSUFFICIENT');
    expect(confidenceForBand('LOW', true)).toBe('WARM_START');
  });
});
