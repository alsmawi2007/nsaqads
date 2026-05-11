import { Injectable } from '@nestjs/common';
import { MetricSnapshotRow, SnapshotTriple, TrendConfidence, TrendSignal } from './trend-types';

// Metrics this analyzer recognizes. Anything else is ignored — adding a
// metric here is the only place needed to extend the trend surface.
const HIGHER_IS_BETTER = new Set<string>(['roas', 'ctr']);
const LOWER_IS_BETTER  = new Set<string>(['cpa', 'cpc']);
const ANALYZED_METRICS = [...HIGHER_IS_BETTER, ...LOWER_IS_BETTER];

// Magnitude thresholds (as decimal fractions, not percent).
// Tuned for advertising data — a 3-day window won't move much without real signal.
const FLAT_THRESHOLD          = 0.03;  // < 3% step → considered flat
const SIGNIFICANT_THRESHOLD   = 0.05;  // < 5% overall → low confidence
const HIGH_CONFIDENCE_OVERALL = 0.15;  // > 15% overall + monotonic → high confidence

// Minimum sample for ANY trend conclusion. Below this we return [].
const MIN_IMPRESSIONS_24H = 1000;

@Injectable()
export class TrendAnalyzerService {
  // Pure: no DB, no network. Idempotent for the same inputs.
  analyze(snapshots: SnapshotTriple, impressions24h: number): TrendSignal[] {
    if (!snapshots.window24h || !snapshots.window48h || !snapshots.window72h) return [];
    if (impressions24h < MIN_IMPRESSIONS_24H) return [];

    const out: TrendSignal[] = [];
    for (const metric of ANALYZED_METRICS) {
      const v24 = numericField(snapshots.window24h, metric);
      const v48 = numericField(snapshots.window48h, metric);
      const v72 = numericField(snapshots.window72h, metric);
      if (v24 === null || v48 === null || v72 === null) continue;
      // Skip degenerate baselines — division by zero produces noise, not signal.
      if (v48 === 0 || v72 === 0) continue;

      const signal = this.classify(metric, v24, v48, v72);
      if (signal) out.push(signal);
    }
    return out;
  }

  private classify(metric: string, v24: number, v48: number, v72: number): TrendSignal | null {
    // Step deltas: recent (24h vs 48h) and older (48h vs 72h).
    // These are the two "intervals" inside the 72h window.
    const stepRecent = (v24 - v48) / v48;
    const stepOlder  = (v48 - v72) / v72;
    const overall    = (v24 - v72) / v72;

    const absStepRecent = Math.abs(stepRecent);
    const absStepOlder  = Math.abs(stepOlder);
    const absOverall    = Math.abs(overall);

    const higherIsBetter = HIGHER_IS_BETTER.has(metric);
    const valuesField = { window24h: v24, window48h: v48, window72h: v72 };

    // ── FLAT: neither step exceeds the FLAT_THRESHOLD ──
    if (absStepRecent < FLAT_THRESHOLD && absStepOlder < FLAT_THRESHOLD) {
      return {
        metric,
        direction: 'FLAT',
        performanceChangePct: null,
        values: valuesField,
        confidence: 'MEDIUM',
        higherIsBetter,
        rationale: `${metric.toUpperCase()} held flat across windows (step changes ${pct(stepRecent)} and ${pct(stepOlder)} — both below ${pct(FLAT_THRESHOLD)}).`,
      };
    }

    // ── VOLATILE: steps oppose each other and both exceed SIGNIFICANT_THRESHOLD ──
    if (
      stepRecent * stepOlder < 0 &&
      absStepRecent > SIGNIFICANT_THRESHOLD &&
      absStepOlder > SIGNIFICANT_THRESHOLD
    ) {
      const swingMagnitude = Math.max(absStepRecent, absStepOlder);
      const confidence: TrendConfidence = swingMagnitude > HIGH_CONFIDENCE_OVERALL ? 'HIGH' : 'MEDIUM';
      return {
        metric,
        direction: 'VOLATILE',
        performanceChangePct: null,
        values: valuesField,
        confidence,
        higherIsBetter,
        rationale: `${metric.toUpperCase()} swung ${pct(stepOlder)} then ${pct(stepRecent)} between windows — opposing directions.`,
      };
    }

    // ── TREND: same-sign steps OR one step within the flat band ──
    const monotonic = stepRecent * stepOlder >= 0;
    // Direction in terms of PERFORMANCE, not raw metric value.
    const performanceChange = higherIsBetter ? overall : -overall;
    const direction: 'UP' | 'DOWN' = performanceChange >= 0 ? 'UP' : 'DOWN';

    // Confidence ladder.
    let confidence: TrendConfidence;
    if (monotonic && absOverall > HIGH_CONFIDENCE_OVERALL) confidence = 'HIGH';
    else if (monotonic && absOverall > SIGNIFICANT_THRESHOLD) confidence = 'MEDIUM';
    else confidence = 'LOW';

    // Suppress ultra-weak trends — they're noise.
    if (absOverall < FLAT_THRESHOLD) {
      return {
        metric,
        direction: 'FLAT',
        performanceChangePct: null,
        values: valuesField,
        confidence: 'LOW',
        higherIsBetter,
        rationale: `${metric.toUpperCase()} drifted ${pct(overall)} across the 72h window — within the flat band.`,
      };
    }

    return {
      metric,
      direction,
      performanceChangePct: round1(performanceChange * 100),
      values: valuesField,
      confidence,
      higherIsBetter,
      rationale: monotonic
        ? `${metric.toUpperCase()} moved ${pct(stepOlder)} → ${pct(stepRecent)} (monotonic, overall ${pct(overall)}).`
        : `${metric.toUpperCase()} moved overall ${pct(overall)} but step changes were not strictly monotonic.`,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function numericField(row: MetricSnapshotRow, key: string): number | null {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (v === null || v === undefined) return null;
  // Prisma Decimal exposes toNumber(); plain numbers and numeric strings also work.
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    const n = (v as { toNumber(): number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

function pct(fraction: number): string {
  const sign = fraction > 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(1)}%`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
