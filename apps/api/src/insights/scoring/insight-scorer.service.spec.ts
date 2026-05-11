import { Platform } from '@prisma/client';
import { InsightScorerService, UnscoredInsight } from './insight-scorer.service';
import { InsightSeverity, InsightType } from '../dto/insight.dto';

function makeInsight(overrides: Partial<UnscoredInsight> = {}): UnscoredInsight {
  return {
    id: 'ins_test',
    orgId: 'org-1',
    entityType: 'CAMPAIGN',
    entityId: 'camp-1',
    entityName: 'Spring Promo',
    platform: 'META' as Platform,
    insightType: InsightType.OPTIMIZATION_OPPORTUNITY,
    severity: InsightSeverity.MEDIUM,
    title: { en: 't', ar: null },
    description: { en: 'd', ar: null },
    context: {},
    relatedRuleId: null,
    relatedActionType: null,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('InsightScorerService', () => {
  const scorer = new InsightScorerService();

  // ─── Range / consistency ──────────────────────────────────────────────────

  it('produces an integer score in [0, 100]', () => {
    const result = scorer.score(makeInsight());
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('is deterministic for identical inputs', () => {
    const insight = makeInsight({ severity: InsightSeverity.HIGH, context: { deltaPct: 20, currentValue: 1000 } });
    const a = scorer.score(insight);
    const b = scorer.score(insight);
    expect(a).toEqual(b);
  });

  it('breakdown contributions sum (within rounding) to the total score', () => {
    const result = scorer.score(makeInsight({ severity: InsightSeverity.HIGH, context: { deltaPct: 30, currentValue: 5000 } }));
    const sum =
      result.scoreBreakdown.severity.contribution +
      result.scoreBreakdown.confidence.contribution +
      result.scoreBreakdown.impact.contribution +
      result.scoreBreakdown.magnitude.contribution +
      result.scoreBreakdown.actionability.contribution +
      result.scoreBreakdown.recency.contribution;
    expect(Math.abs(result.scoreBreakdown.total - sum)).toBeLessThanOrEqual(1);
    expect(result.score).toBe(result.scoreBreakdown.total);
  });

  // ─── Priority bands ───────────────────────────────────────────────────────

  it('promotes a HIGH-severity, high-confidence, big-budget action to CRITICAL', () => {
    const result = scorer.score(makeInsight({
      insightType: InsightType.PERFORMANCE_RISK,
      severity: InsightSeverity.HIGH,
      context: { deltaPct: -25, currentValue: 10000, confidence: 'HIGH' },
    }));
    expect(result.priority).toBe('CRITICAL');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('keeps a noise-tier insight (RULE_NOT_TRIGGERED, INFO) at LOW priority', () => {
    const result = scorer.score(makeInsight({
      insightType: InsightType.RULE_NOT_TRIGGERED,
      severity: InsightSeverity.INFO,
      context: {},
    }));
    expect(result.priority).toBe('LOW');
    expect(result.score).toBeLessThan(40);
  });

  it('places a LEARNING_PHASE INFO insight in the LOW band', () => {
    const result = scorer.score(makeInsight({
      insightType: InsightType.LEARNING_PHASE,
      severity: InsightSeverity.INFO,
    }));
    expect(result.priority).toBe('LOW');
  });

  // ─── Factor sensitivity ───────────────────────────────────────────────────

  it('scales severity monotonically: HIGH > MEDIUM > LOW > INFO', () => {
    const at = (sev: InsightSeverity) => scorer.score(makeInsight({ severity: sev })).score;
    expect(at(InsightSeverity.HIGH)).toBeGreaterThan(at(InsightSeverity.MEDIUM));
    expect(at(InsightSeverity.MEDIUM)).toBeGreaterThan(at(InsightSeverity.LOW));
    expect(at(InsightSeverity.LOW)).toBeGreaterThan(at(InsightSeverity.INFO));
  });

  it('scales confidence monotonically when present in context: HIGH > MEDIUM > LOW', () => {
    const at = (conf: string) => scorer.score(makeInsight({
      insightType: InsightType.TREND_DOWN,
      severity: InsightSeverity.MEDIUM,
      context: { confidence: conf, performanceChangePct: -15 },
    })).score;
    expect(at('HIGH')).toBeGreaterThan(at('MEDIUM'));
    expect(at('MEDIUM')).toBeGreaterThan(at('LOW'));
  });

  it('scales impact monotonically with budget: $10000 ≥ $1000 ≥ $100', () => {
    const at = (v: number) => scorer.score(makeInsight({
      severity: InsightSeverity.MEDIUM,
      context: { currentValue: v },
    })).scoreBreakdown.impact.value;
    expect(at(10000)).toBeGreaterThan(at(1000));
    expect(at(1000)).toBeGreaterThan(at(100));
  });

  it('scales magnitude monotonically with |deltaPct|, saturating at 50%', () => {
    const at = (d: number) => scorer.score(makeInsight({
      severity: InsightSeverity.MEDIUM,
      context: { deltaPct: d },
    })).scoreBreakdown.magnitude.value;
    expect(at(5)).toBeLessThan(at(25));
    expect(at(25)).toBeLessThan(at(50));
    expect(at(75)).toBeCloseTo(at(50), 5); // saturated
  });

  it('treats absolute deltaPct identically regardless of sign', () => {
    const pos = scorer.score(makeInsight({ context: { deltaPct: 20 } })).scoreBreakdown.magnitude.value;
    const neg = scorer.score(makeInsight({ context: { deltaPct: -20 } })).scoreBreakdown.magnitude.value;
    expect(pos).toBe(neg);
  });

  // ─── Defaults / fallbacks ─────────────────────────────────────────────────

  it('uses neutral impact (0.5) when no monetary value is in context', () => {
    const result = scorer.score(makeInsight({ context: {} }));
    expect(result.scoreBreakdown.impact.value).toBeCloseTo(0.5, 5);
  });

  it('uses default confidence (MEDIUM, 0.7) when context.confidence is absent', () => {
    const result = scorer.score(makeInsight({ context: {} }));
    expect(result.scoreBreakdown.confidence.value).toBeCloseTo(0.7, 5);
  });

  it('falls back to performanceChangePct when deltaPct is absent', () => {
    const a = scorer.score(makeInsight({ context: { performanceChangePct: 30 } })).scoreBreakdown.magnitude.value;
    const b = scorer.score(makeInsight({ context: { deltaPct: 30 } })).scoreBreakdown.magnitude.value;
    expect(a).toBeCloseTo(b, 5);
  });

  // ─── Ordering invariant ───────────────────────────────────────────────────

  it('ranks an actionable HIGH risk above an INFO trend on the same entity', () => {
    const risk = scorer.score(makeInsight({
      insightType: InsightType.PERFORMANCE_RISK,
      severity: InsightSeverity.HIGH,
      context: { deltaPct: -20, currentValue: 1000 },
    })).score;
    const trendUp = scorer.score(makeInsight({
      insightType: InsightType.TREND_UP,
      severity: InsightSeverity.INFO,
      context: { performanceChangePct: 20, confidence: 'HIGH' },
    })).score;
    expect(risk).toBeGreaterThan(trendUp);
  });
});
