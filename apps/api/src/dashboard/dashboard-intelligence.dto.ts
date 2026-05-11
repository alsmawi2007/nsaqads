import { ApiProperty } from '@nestjs/swagger';
import { ActionType, Platform } from '@prisma/client';
import { InsightSeverity, InsightType } from '../insights/dto/insight.dto';
import { InsightPriority } from '../insights/scoring/insight-scorer.types';
import { RuleHealth } from '../insights/learning/rule-performance.types';
import { SimulatedActionType } from '../insights/learning/rule-tuner-simulation.dto';

// Org-scoped operator dashboard. Aggregates every read-only intelligence
// surface in a single response so the UI renders the operator's home view
// without orchestrating five separate calls.
//
// All fields are pre-flattened to plain primitives where possible — title /
// description are pulled to the .en string so the UI does not need to
// re-resolve the {en, ar} envelope on every render. The richer shapes
// remain available via their dedicated endpoints (/insights, /rules/health,
// /rules/simulation, /rules/auto-tune/observability) for drill-down.

// ─── Health summary ──────────────────────────────────────────────────────────

export class DashboardSeverityCountsDto {
  @ApiProperty() info!: number;
  @ApiProperty() low!: number;
  @ApiProperty() medium!: number;
  @ApiProperty() high!: number;
}

export class DashboardHealthSummaryDto {
  @ApiProperty({
    description:
      'Live insights in scope right now (after evaluator + scorer). Equivalent to the size of the InsightsService.listForOrg payload.',
  })
  totalActiveInsights!: number;

  @ApiProperty({
    type: DashboardSeverityCountsDto,
    description: 'Counts across the four InsightSeverity bands of the live list.',
  })
  bySeverity!: DashboardSeverityCountsDto;

  @ApiProperty({
    description: 'InsightInteraction rows recorded for this org (any status or feedback).',
  })
  totalInteractions!: number;

  @ApiProperty({ description: 'Rows with feedback non-null. Denominator for the rates below.' })
  withFeedbackCount!: number;

  @ApiProperty({ description: 'USEFUL / withFeedbackCount.' })             usefulRate!: number;
  @ApiProperty({ description: 'NOT_USEFUL / withFeedbackCount.' })         notUsefulRate!: number;
  @ApiProperty({ description: 'WRONG / withFeedbackCount.' })              wrongRate!: number;
  @ApiProperty({ description: 'NEEDS_MORE_CONTEXT / withFeedbackCount.' }) needsMoreContextRate!: number;
}

// ─── Top insights ────────────────────────────────────────────────────────────

export class DashboardTopInsightDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: InsightType })
  insightType!: InsightType;

  @ApiProperty({ enum: InsightSeverity })
  severity!: InsightSeverity;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  priority!: InsightPriority;

  @ApiProperty({ description: 'Score 0..100 — already used to sort this list.' })
  score!: number;

  @ApiProperty({ description: 'English title (pre-resolved from the {en, ar} envelope for fast rendering).' })
  title!: string;

  @ApiProperty({ description: 'English description (pre-resolved from the {en, ar} envelope).' })
  description!: string;

  @ApiProperty({ enum: ['CAMPAIGN', 'AD_SET'] })
  entityType!: 'CAMPAIGN' | 'AD_SET';

  @ApiProperty()
  entityId!: string;

  @ApiProperty()
  entityName!: string;

  @ApiProperty({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  platform!: Platform;

  @ApiProperty({ nullable: true, description: 'Source rule id when the insight derives from a single rule evaluation.' })
  relatedRuleId!: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['INCREASE_BUDGET', 'DECREASE_BUDGET', 'SWITCH_BIDDING_STRATEGY', 'ADJUST_BID_CEILING', 'ADJUST_BID_FLOOR'],
  })
  relatedActionType!: ActionType | null;
}

// ─── Trend highlights ────────────────────────────────────────────────────────

export class DashboardTrendHighlightDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    enum: [InsightType.TREND_UP, InsightType.TREND_DOWN, InsightType.VOLATILITY_HIGH, InsightType.PERFORMANCE_STAGNANT],
  })
  insightType!: InsightType;

  @ApiProperty({ enum: ['CAMPAIGN', 'AD_SET'] })
  entityType!: 'CAMPAIGN' | 'AD_SET';

  @ApiProperty()
  entityId!: string;

  @ApiProperty()
  entityName!: string;

  @ApiProperty({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  platform!: Platform;

  @ApiProperty({ enum: InsightSeverity })
  severity!: InsightSeverity;

  @ApiProperty()
  score!: number;

  @ApiProperty()
  title!: string;
}

// ─── Rule health summary ─────────────────────────────────────────────────────

export class DashboardRuleHealthSummaryDto {
  @ApiProperty()
  totalRules!: number;

  @ApiProperty({ description: 'Rules classified HEALTHY.' })
  healthy!: number;

  @ApiProperty({ description: 'Rules classified NEEDS_TUNING.' })
  needsTuning!: number;

  @ApiProperty({ description: 'Rules classified UNSTABLE.' })
  unstable!: number;

  @ApiProperty({ description: 'Rules classified LOW_SIGNAL.' })
  lowSignal!: number;

  @ApiProperty({ description: 'Average ruleScore across non-LOW_SIGNAL rules. 0 when no qualifying rules exist.' })
  averageRuleScore!: number;

  @ApiProperty({
    type: [String],
    description: 'Up to 5 rule ids whose health is NEEDS_TUNING — for the "needs your attention" UI strip.',
  })
  topNeedsTuningRuleIds!: string[];
}

// ─── Simulation summary ──────────────────────────────────────────────────────

export class DashboardSimulationSummaryDto {
  @ApiProperty({ description: 'Always true — the simulation never modifies any rule.' })
  isShadowMode!: true;

  @ApiProperty()
  totalRules!: number;

  @ApiProperty({
    description: 'Distribution across SimulatedActionType. Plain object so the UI iterates without re-resolving an enum.',
  })
  rulesByAction!: Record<SimulatedActionType, number>;

  @ApiProperty({
    description:
      'Net change in projected OptimizerAction firings across all rules. Negative means the simulation would suppress firings overall.',
  })
  totalProjectedActionDelta!: number;

  @ApiProperty({ description: 'Rules whose impact projection has HIGH confidence.' })
  highConfidenceRuleCount!: number;

  @ApiProperty({ description: 'Days of OptimizerAction history that fed the projection.' })
  lookbackDays!: number;
}

// ─── Auto-tune status ────────────────────────────────────────────────────────

export class DashboardAutoTuneStatusDto {
  @ApiProperty({ description: 'Distinct auto-tune runs in scope. 0 when the org has never been tuned.' })
  totalRuns!: number;

  @ApiProperty({ description: 'Log rows still in APPLIED status — every change still in effect.' })
  totalAppliedChanges!: number;

  @ApiProperty({ description: 'Log rows whose status flipped to ROLLED_BACK.' })
  totalRolledBackChanges!: number;

  @ApiProperty({ nullable: true, description: 'runId of the most recent run that had any applied log rows.' })
  lastRunId!: string | null;

  @ApiProperty({ nullable: true, description: 'Earliest appliedAt across the last applied run.' })
  lastRunStartedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'Latest appliedAt across the last applied run.' })
  lastRunFinishedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'Applied rows in the last run.' })
  lastRunAppliedCount!: number | null;

  @ApiProperty({ nullable: true, description: 'Rolled-back rows in the last run.' })
  lastRunRolledBackCount!: number | null;

  @ApiProperty({ description: 'True when a fresh run would be blocked by cooldown.' })
  cooldownActive!: boolean;

  @ApiProperty({ nullable: true })
  cooldownExpiresAt!: string | null;

  @ApiProperty({ nullable: true, description: 'Whole minutes remaining on the cooldown.' })
  cooldownRemainingMinutes!: number | null;
}

// ─── Top-level response ──────────────────────────────────────────────────────

export class OrgDashboardIntelligenceDto {
  @ApiProperty()
  orgId!: string;

  @ApiProperty({ type: DashboardHealthSummaryDto })
  health!: DashboardHealthSummaryDto;

  @ApiProperty({ type: [DashboardTopInsightDto], description: 'Up to 10 highest-scoring active insights.' })
  topInsights!: DashboardTopInsightDto[];

  @ApiProperty({
    type: [DashboardTrendHighlightDto],
    description: 'Up to 5 highest-scoring trend / volatility / stagnation insights.',
  })
  trendHighlights!: DashboardTrendHighlightDto[];

  @ApiProperty({ type: DashboardRuleHealthSummaryDto })
  ruleHealth!: DashboardRuleHealthSummaryDto;

  @ApiProperty({ type: DashboardSimulationSummaryDto })
  simulation!: DashboardSimulationSummaryDto;

  @ApiProperty({ type: DashboardAutoTuneStatusDto })
  autoTune!: DashboardAutoTuneStatusDto;

  @ApiProperty({ description: 'ISO timestamp the dashboard was assembled.' })
  generatedAt!: string;
}
