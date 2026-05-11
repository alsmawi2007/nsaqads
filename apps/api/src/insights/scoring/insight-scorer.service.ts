import { Injectable } from '@nestjs/common';
import { InsightDto, InsightSeverity, InsightType } from '../dto/insight.dto';
import { InsightPriority, InsightScoreBreakdown, InsightScoreFactor } from './insight-scorer.types';

// An InsightDto without the scoring fields and without the per-user interaction
// overlay — what the builders in InsightsService produce before the scorer and
// the interactions overlay run.
export type UnscoredInsight = Omit<
  InsightDto,
  'score' | 'priority' | 'scoreBreakdown' | 'userStatus' | 'feedback' | 'userNote' | 'interactedAt'
>;

// Factor weights. Sum must equal 1.0; the scorer asserts this at construction
// time so a future tweak that breaks the invariant fails loudly.
const WEIGHTS = {
  severity:       0.30,
  confidence:     0.15,
  impact:         0.20,
  magnitude:      0.15,
  actionability:  0.15,
  recency:        0.05,
} as const;

// Severity → normalized factor. INFO is a small floor so awareness insights
// never collapse to 0.
const SEVERITY_FACTOR: Record<InsightSeverity, number> = {
  [InsightSeverity.HIGH]:   0.90,
  [InsightSeverity.MEDIUM]: 0.60,
  [InsightSeverity.LOW]:    0.35,
  [InsightSeverity.INFO]:   0.15,
};

// Insight type → "how actionable is this right now". Drives the
// actionability factor when no other signal is available.
const ACTIONABILITY: Record<InsightType, number> = {
  [InsightType.PERFORMANCE_RISK]:         1.00,
  [InsightType.READY_FOR_ACTION]:         1.00,
  [InsightType.OPTIMIZATION_OPPORTUNITY]: 0.90,
  [InsightType.TREND_DOWN]:               0.70,
  [InsightType.VOLATILITY_HIGH]:          0.60,
  [InsightType.PERFORMANCE_STAGNANT]:     0.50,
  [InsightType.TREND_UP]:                 0.40,
  [InsightType.INSUFFICIENT_DATA]:        0.30,
  [InsightType.LEARNING_PHASE]:           0.20,
  [InsightType.RULE_NOT_TRIGGERED]:       0.10,
};

// Priority bands. Tuned so a HIGH-severity actionable insight on a meaningful
// budget reliably reaches CRITICAL, while INFO awareness insights stay LOW.
function priorityForScore(score: number): InsightPriority {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

@Injectable()
export class InsightScorerService {
  constructor() {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    // Tolerance for floating-point summation; weights are constants so this
    // only fires if a developer changes one and forgets to rebalance.
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`InsightScorer weights must sum to 1.0 (got ${sum}).`);
    }
  }

  // Pure: same input → same output. No DB, no network. Safe to call inside
  // a hot loop while building the insights response.
  score(insight: UnscoredInsight): {
    score: number;
    priority: InsightPriority;
    scoreBreakdown: InsightScoreBreakdown;
  } {
    const factors = {
      severity:      SEVERITY_FACTOR[insight.severity],
      confidence:    confidenceFactor(insight),
      impact:        impactFactor(insight),
      magnitude:     magnitudeFactor(insight),
      actionability: ACTIONABILITY[insight.insightType],
      // All insights are computed live in Phase 1; no staleness.
      // The factor is kept so future persisted-insight workflows can decay it.
      recency:       1.0,
    };

    const breakdown: InsightScoreBreakdown = {
      severity:      factor(factors.severity, WEIGHTS.severity),
      confidence:    factor(factors.confidence, WEIGHTS.confidence),
      impact:        factor(factors.impact, WEIGHTS.impact),
      magnitude:     factor(factors.magnitude, WEIGHTS.magnitude),
      actionability: factor(factors.actionability, WEIGHTS.actionability),
      recency:       factor(factors.recency, WEIGHTS.recency),
      total: 0,
    };

    const total = Math.round(
      breakdown.severity.contribution +
      breakdown.confidence.contribution +
      breakdown.impact.contribution +
      breakdown.magnitude.contribution +
      breakdown.actionability.contribution +
      breakdown.recency.contribution,
    );
    breakdown.total = total;

    return {
      score: total,
      priority: priorityForScore(total),
      scoreBreakdown: breakdown,
    };
  }
}

// ─── Factor extractors ──────────────────────────────────────────────────────

function confidenceFactor(i: UnscoredInsight): number {
  const raw = pickString(i.context, 'confidence');
  if (raw === 'HIGH')   return 1.0;
  if (raw === 'MEDIUM') return 0.7;
  if (raw === 'LOW')    return 0.4;
  // Rule-driven insights don't carry an explicit confidence — treat them as
  // MEDIUM since they are deterministic threshold matches against real data.
  return 0.7;
}

// Log-scaled budget / spend impact: $100 ≈ 0.50, $1000 ≈ 0.75, $10000+ = 1.0.
// Returns 0.5 (neutral) when no monetary signal is available, so awareness
// insights aren't penalized for lacking spend context.
function impactFactor(i: UnscoredInsight): number {
  const value =
    pickNumber(i.context, 'currentValue') ??
    pickNumber(i.context, 'proposedValue') ??
    pickNumber(i.context, 'spend');
  if (value === null || value <= 0) return 0.5;
  const logged = Math.log10(1 + value) / Math.log10(1 + 10000);
  return clamp01(logged);
}

// Magnitude of change in performance terms. A 50%+ swing saturates the
// factor — beyond that the move is the story regardless of exact size.
function magnitudeFactor(i: UnscoredInsight): number {
  const candidates = [
    pickNumber(i.context, 'deltaPct'),
    pickNumber(i.context, 'performanceChangePct'),
  ];
  const v = candidates.find((n) => n !== null);
  if (v === null || v === undefined) return 0.3;
  return clamp01(Math.abs(v) / 50);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function factor(value: number, weight: number): InsightScoreFactor {
  const contribution = round1(value * weight * 100);
  return { value: round3(value), weight, contribution };
}

function pickNumber(ctx: Record<string, unknown>, key: string): number | null {
  const v = ctx[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickString(ctx: Record<string, unknown>, key: string): string | null {
  const v = ctx[key];
  return typeof v === 'string' ? v.toUpperCase() : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
