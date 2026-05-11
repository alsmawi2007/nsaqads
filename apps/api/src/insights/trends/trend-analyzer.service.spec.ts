import { TrendAnalyzerService } from './trend-analyzer.service';
import { MetricSnapshotRow, SnapshotTriple } from './trend-types';

// Build a minimal MetricSnapshotRow with the metric fields we care about.
// Other fields are filled with neutral defaults.
function row(overrides: Partial<Record<keyof MetricSnapshotRow, unknown>>): MetricSnapshotRow {
  return {
    spend: 0,
    impressions: 0,
    ctr: 0,
    cpc: 0,
    cpa: 0,
    roas: 0,
    spendPacing: 1,
    ...overrides,
  };
}

function triple(w24: Partial<MetricSnapshotRow>, w48: Partial<MetricSnapshotRow>, w72: Partial<MetricSnapshotRow>): SnapshotTriple {
  return { window24h: row(w24), window48h: row(w48), window72h: row(w72) };
}

describe('TrendAnalyzerService', () => {
  const analyzer = new TrendAnalyzerService();

  // ─── Gate: missing data ──────────────────────────────────────────────────

  it('returns [] when any window snapshot is missing', () => {
    expect(
      analyzer.analyze({ window24h: row({ roas: 5 }), window48h: null, window72h: row({ roas: 4 }) }, 5000),
    ).toEqual([]);
  });

  it('returns [] when 24h impressions are below MIN_IMPRESSIONS_24H', () => {
    const t = triple({ roas: 5 }, { roas: 4 }, { roas: 3 });
    expect(analyzer.analyze(t, 500)).toEqual([]);
  });

  // ─── FLAT direction ──────────────────────────────────────────────────────

  it('classifies metrics as FLAT when both step deltas are below the flat threshold', () => {
    // ROAS: 4.00 → 4.05 → 4.06 (≈+1.25%, ≈+0.25%) — both well below 3% flat band
    const t = triple({ roas: 4.06 }, { roas: 4.05 }, { roas: 4.00 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('FLAT');
    expect(roas!.confidence).toBe('MEDIUM');
    expect(roas!.performanceChangePct).toBeNull();
    expect(roas!.higherIsBetter).toBe(true);
  });

  it('reclassifies a near-zero overall change as FLAT/LOW when steps land in the 3–5% band', () => {
    // ROAS: 4.00 → 3.86 → 4.00 (steps ≈ ±3.6%) — both above flat band but
    // below significant 5%, so VOLATILE does not fire. Falls into TREND with
    // overall ≈ 0% which gets reclassified to FLAT/LOW.
    const t = triple({ roas: 4.0 }, { roas: 3.86 }, { roas: 4.0 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('FLAT');
    expect(roas!.confidence).toBe('LOW');
  });

  // ─── VOLATILE direction ──────────────────────────────────────────────────

  it('classifies opposing-sign step changes as VOLATILE with HIGH confidence on large swings', () => {
    // ROAS: 4.00 → 5.00 (+25%) → 4.00 (−20%): big swing both ways
    const t = triple({ roas: 4.0 }, { roas: 5.0 }, { roas: 4.0 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('VOLATILE');
    expect(roas!.confidence).toBe('HIGH');
    expect(roas!.performanceChangePct).toBeNull();
  });

  it('classifies opposing steps with smaller swing as VOLATILE / MEDIUM', () => {
    // ROAS: 4.00 → 4.30 (+7.5%) → 4.00 (−6.97%): both above significant 5%, swing < 15%
    const t = triple({ roas: 4.0 }, { roas: 4.3 }, { roas: 4.0 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('VOLATILE');
    expect(roas!.confidence).toBe('MEDIUM');
  });

  // ─── TREND UP / DOWN — higher-is-better metrics (roas, ctr) ──────────────

  it('classifies a monotonic ROAS increase as UP with HIGH confidence when overall > 15%', () => {
    // ROAS: 3.0 → 3.3 → 3.6 (+10% then +9.09%, overall +20%)
    const t = triple({ roas: 3.6 }, { roas: 3.3 }, { roas: 3.0 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('UP');
    expect(roas!.confidence).toBe('HIGH');
    expect(roas!.performanceChangePct).toBeGreaterThan(15);
    expect(roas!.higherIsBetter).toBe(true);
  });

  it('classifies a monotonic ROAS decrease as DOWN', () => {
    // ROAS: 5.0 → 4.0 → 3.0 — both steps negative, overall −40%
    const t = triple({ roas: 3.0 }, { roas: 4.0 }, { roas: 5.0 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('DOWN');
    expect(roas!.confidence).toBe('HIGH');
    expect(roas!.performanceChangePct).toBeLessThan(0);
  });

  it('uses MEDIUM confidence for monotonic moves between 5% and 15% overall', () => {
    // ROAS: 4.0 → 4.2 → 4.4 (overall +10%, monotonic)
    const t = triple({ roas: 4.4 }, { roas: 4.2 }, { roas: 4.0 });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('UP');
    expect(roas!.confidence).toBe('MEDIUM');
  });

  // ─── TREND UP / DOWN — lower-is-better metrics (cpa, cpc) ────────────────

  it('treats falling CPA as performance UP (lower-is-better inverted)', () => {
    // CPA: 30 → 25 → 20 — value decreasing, but performance is improving.
    const t = triple({ cpa: 20 }, { cpa: 25 }, { cpa: 30 });
    const signals = analyzer.analyze(t, 5000);
    const cpa = signals.find((s) => s.metric === 'cpa');
    expect(cpa).toBeDefined();
    expect(cpa!.direction).toBe('UP');
    expect(cpa!.higherIsBetter).toBe(false);
    expect(cpa!.performanceChangePct!).toBeGreaterThan(0);
  });

  it('treats rising CPA as performance DOWN', () => {
    // CPA: 20 → 25 → 30 — cost rising, performance degrading.
    const t = triple({ cpa: 30 }, { cpa: 25 }, { cpa: 20 });
    const signals = analyzer.analyze(t, 5000);
    const cpa = signals.find((s) => s.metric === 'cpa');
    expect(cpa).toBeDefined();
    expect(cpa!.direction).toBe('DOWN');
    expect(cpa!.higherIsBetter).toBe(false);
    expect(cpa!.performanceChangePct!).toBeLessThan(0);
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────

  it('skips metrics with missing or null values', () => {
    const t = triple({ roas: 5 }, { roas: null }, { roas: 4 });
    const signals = analyzer.analyze(t, 5000);
    expect(signals.find((s) => s.metric === 'roas')).toBeUndefined();
  });

  it('skips metrics where the baseline (48h or 72h) is zero to avoid division by zero', () => {
    const t = triple({ roas: 5 }, { roas: 0 }, { roas: 4 });
    const signals = analyzer.analyze(t, 5000);
    expect(signals.find((s) => s.metric === 'roas')).toBeUndefined();
  });

  it('coerces Prisma Decimal-like objects (toNumber) into numbers', () => {
    const decimal = (n: number) => ({ toNumber: () => n });
    const t = triple({ roas: decimal(3.6) }, { roas: decimal(3.3) }, { roas: decimal(3.0) });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('UP');
  });

  it('coerces numeric strings into numbers', () => {
    const t = triple({ roas: '3.6' }, { roas: '3.3' }, { roas: '3.0' });
    const signals = analyzer.analyze(t, 5000);
    const roas = signals.find((s) => s.metric === 'roas');
    expect(roas).toBeDefined();
    expect(roas!.direction).toBe('UP');
  });

  it('only emits signals for known metrics (roas, ctr, cpa, cpc), ignoring others', () => {
    const t = triple(
      { roas: 4, ctr: 0.05, cpa: 20, cpc: 0.5, spend: 999, impressions: 999 },
      { roas: 4, ctr: 0.05, cpa: 20, cpc: 0.5, spend: 999, impressions: 999 },
      { roas: 4, ctr: 0.05, cpa: 20, cpc: 0.5, spend: 999, impressions: 999 },
    );
    const signals = analyzer.analyze(t, 5000);
    const metricsSeen = new Set(signals.map((s) => s.metric));
    expect(metricsSeen.size).toBeLessThanOrEqual(4);
    expect([...metricsSeen].every((m) => ['roas', 'ctr', 'cpa', 'cpc'].includes(m))).toBe(true);
  });
});
