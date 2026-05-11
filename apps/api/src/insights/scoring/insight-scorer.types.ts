// Priority bands derived from the numeric insight score (0–100).
// Distinct from InsightSeverity, which is a symbolic classification of the
// underlying condition. Two insights can share the same severity but different
// priorities once entity spend, magnitude, and actionability are factored in.
export type InsightPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// One factor's contribution to the score. `value` is the normalized factor
// in [0, 1]; `weight` is the factor's share of the total; `contribution` is
// `value × weight × 100` rounded to one decimal — i.e. how many of the 100
// points this factor delivered.
export interface InsightScoreFactor {
  value: number;
  weight: number;
  contribution: number;
}

// Full per-factor breakdown plus the integer 0–100 total. `total` is the
// rounded sum of contributions and is what populates InsightDto.score.
export interface InsightScoreBreakdown {
  severity:       InsightScoreFactor;
  confidence:     InsightScoreFactor;
  impact:         InsightScoreFactor;
  magnitude:      InsightScoreFactor;
  actionability:  InsightScoreFactor;
  recency:        InsightScoreFactor;
  total:          number;
}
