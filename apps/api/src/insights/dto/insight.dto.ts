import { ApiProperty } from '@nestjs/swagger';
import { ActionType, InsightFeedback, InsightInteractionStatus, Platform } from '@prisma/client';
import { InsightPriority, InsightScoreBreakdown } from '../scoring/insight-scorer.types';

// Diagnostic / explanatory surface for the dashboard. Distinct from
// OptimizerAction (which is executable). An insight describes "why" the
// system sees something — actionable or not — and may reference a rule
// and/or a proposed action without ever applying it.
export enum InsightType {
  // A rule fired with a cost-cutting / risk-mitigation action attached.
  PERFORMANCE_RISK = 'PERFORMANCE_RISK',
  // A rule fired with a growth / efficiency action attached.
  OPTIMIZATION_OPPORTUNITY = 'OPTIMIZATION_OPPORTUNITY',
  // Entity has no metrics, or a rule was skipped due to KPI / sample-size gaps.
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  // Campaign is in the LEARNING phase; the optimizer abstains from action.
  LEARNING_PHASE = 'LEARNING_PHASE',
  // A rule was applicable but its threshold was not met (or baseline missing).
  RULE_NOT_TRIGGERED = 'RULE_NOT_TRIGGERED',
  // Per-entity rollup: at least one proposed action exists and could be approved now.
  READY_FOR_ACTION = 'READY_FOR_ACTION',

  // ─── Behavior-driven (Trend & Pattern) ──────────────────────────────────
  // Performance is improving across recent metric windows.
  TREND_UP = 'TREND_UP',
  // Performance is degrading across recent metric windows.
  TREND_DOWN = 'TREND_DOWN',
  // Metric values are swinging between windows — unstable delivery.
  VOLATILITY_HIGH = 'VOLATILITY_HIGH',
  // Multiple KPIs are flat across the 72h window — neither improving nor degrading.
  PERFORMANCE_STAGNANT = 'PERFORMANCE_STAGNANT',
}

export enum InsightSeverity {
  INFO   = 'INFO',
  LOW    = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH   = 'HIGH',
}

export class InsightDto {
  @ApiProperty({ description: 'Deterministic ID derived from entity + source — stable across requests when state is unchanged.' })
  id!: string;

  @ApiProperty()
  orgId!: string;

  @ApiProperty({ enum: ['CAMPAIGN', 'AD_SET'] })
  entityType!: 'CAMPAIGN' | 'AD_SET';

  @ApiProperty()
  entityId!: string;

  @ApiProperty()
  entityName!: string;

  @ApiProperty({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  platform!: Platform;

  @ApiProperty({ enum: InsightType })
  insightType!: InsightType;

  @ApiProperty({ enum: InsightSeverity })
  severity!: InsightSeverity;

  @ApiProperty({ description: 'Short headline. ar reserved for Phase 2 (always null today).' })
  title!: { en: string; ar: null };

  @ApiProperty({ description: 'Full explanation. ar reserved for Phase 2 (always null today).' })
  description!: { en: string; ar: null };

  @ApiProperty({ description: 'Structured payload — KPI values, thresholds, affected rule IDs, etc. Shape depends on insightType.' })
  context!: Record<string, unknown>;

  @ApiProperty({ nullable: true, description: 'Source rule, if the insight derives from a single rule evaluation.' })
  relatedRuleId!: string | null;

  @ApiProperty({ nullable: true, enum: ['INCREASE_BUDGET', 'DECREASE_BUDGET', 'SWITCH_BIDDING_STRATEGY', 'ADJUST_BID_CEILING', 'ADJUST_BID_FLOOR'] })
  relatedActionType!: ActionType | null;

  @ApiProperty({ description: 'ISO timestamp the insight was computed.' })
  generatedAt!: string;

  @ApiProperty({ description: 'Unified priority score in 0–100. Higher = more important.' })
  score!: number;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], description: 'Priority band derived from score.' })
  priority!: InsightPriority;

  @ApiProperty({ description: 'Per-factor decomposition of the score (severity, confidence, impact, magnitude, actionability, recency) plus the total.' })
  scoreBreakdown!: InsightScoreBreakdown;

  // ─── Per-user interaction overlay (null if the caller has never acted on this insight) ───

  @ApiProperty({ enum: ['SEEN', 'DISMISSED', 'SAVED'], nullable: true, description: 'Caller’s latest lifecycle status on this insight.' })
  userStatus!: InsightInteractionStatus | null;

  @ApiProperty({ enum: ['USEFUL', 'NOT_USEFUL', 'WRONG', 'NEEDS_MORE_CONTEXT'], nullable: true, description: 'Caller’s most recent feedback verdict.' })
  feedback!: InsightFeedback | null;

  @ApiProperty({ nullable: true, description: 'Free-text note captured alongside feedback.' })
  userNote!: string | null;

  @ApiProperty({ nullable: true, description: 'ISO timestamp the caller last interacted (status change or feedback) with this insight.' })
  interactedAt!: string | null;
}

export class InsightListResponseDto {
  @ApiProperty({ type: [InsightDto] })
  insights!: InsightDto[];

  @ApiProperty({ description: 'Counts by severity for badge display.' })
  totals!: { info: number; low: number; medium: number; high: number };

  @ApiProperty()
  generatedAt!: string;
}
