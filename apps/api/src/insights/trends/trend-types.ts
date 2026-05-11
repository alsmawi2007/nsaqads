// Behavior-level signals derived from MetricSnapshot windows. The analyzer
// translates raw 24h/48h/72h values into these signals; the InsightsService
// then converts each signal into an InsightDto.

export type TrendDirection = 'UP' | 'DOWN' | 'FLAT' | 'VOLATILE';

export type TrendConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

// One signal per metric. "performance" is normalized: positive
// performanceChangePct always means "better" — for ROAS/CTR that maps to
// the raw value rising; for CPA/CPC it maps to the raw value falling.
export interface TrendSignal {
  metric: string;
  direction: TrendDirection;
  // Performance-aligned %. null when direction is not UP/DOWN.
  performanceChangePct: number | null;
  // Raw recency-ordered values (most recent first) for transparency / UI tooltips.
  values: { window24h: number; window48h: number; window72h: number };
  confidence: TrendConfidence;
  // Whether the metric is one where higher raw value = better outcome.
  higherIsBetter: boolean;
  // One-sentence explanation for descriptions, e.g. "monotonic increase 15%→18%".
  rationale: string;
}

// One snapshot per window, as Prisma row shape (callers pass Prisma rows
// straight in). Decimals are coerced to number inside the analyzer.
export interface MetricSnapshotRow {
  spend: unknown;
  impressions: unknown;
  ctr: unknown;
  cpc: unknown;
  cpa: unknown;
  roas: unknown;
  spendPacing: unknown;
}

export interface SnapshotTriple {
  window24h: MetricSnapshotRow | null;
  window48h: MetricSnapshotRow | null;
  window72h: MetricSnapshotRow | null;
}
