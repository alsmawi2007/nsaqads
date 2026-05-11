import { ApiProperty } from '@nestjs/swagger';
import { ActionType, InsightFeedback, InsightInteractionStatus, Platform } from '@prisma/client';

export class InsightStatusCountsDto {
  @ApiProperty() SEEN!: number;
  @ApiProperty() DISMISSED!: number;
  @ApiProperty() SAVED!: number;
}

export class InsightFeedbackCountsDto {
  @ApiProperty() USEFUL!: number;
  @ApiProperty() NOT_USEFUL!: number;
  @ApiProperty() WRONG!: number;
  @ApiProperty() NEEDS_MORE_CONTEXT!: number;
}

export class InsightAnalyticsRatesDto {
  @ApiProperty({ description: 'SEEN / withStatusCount.' })       seenRate!: number;
  @ApiProperty({ description: 'DISMISSED / withStatusCount.' })  dismissedRate!: number;
  @ApiProperty({ description: 'SAVED / withStatusCount.' })      savedRate!: number;
  @ApiProperty({ description: 'USEFUL / withFeedbackCount.' })             usefulRate!: number;
  @ApiProperty({ description: 'NOT_USEFUL / withFeedbackCount.' })         notUsefulRate!: number;
  @ApiProperty({ description: 'WRONG / withFeedbackCount.' })              wrongRate!: number;
  @ApiProperty({ description: 'NEEDS_MORE_CONTEXT / withFeedbackCount.' }) needsMoreContextRate!: number;
}

// Single aggregation block — used both for the org-wide totals and for each
// per-dimension bucket (insightType, priority, ...). Identical shape so the
// frontend can render every bucket with the same component.
export class InsightAnalyticsBlockDto {
  @ApiProperty({ description: 'Total interaction rows in this bucket (status OR feedback may be set).' })
  interactionCount!: number;

  @ApiProperty({ description: 'Rows where status is non-null. Denominator for status rates.' })
  withStatusCount!: number;

  @ApiProperty({ description: 'Rows where feedback is non-null. Denominator for feedback rates.' })
  withFeedbackCount!: number;

  @ApiProperty({ type: InsightStatusCountsDto })
  statusCounts!: InsightStatusCountsDto;

  @ApiProperty({ type: InsightFeedbackCountsDto })
  feedbackCounts!: InsightFeedbackCountsDto;

  @ApiProperty({ type: InsightAnalyticsRatesDto })
  rates!: InsightAnalyticsRatesDto;
}

export class InsightAnalyticsBucketDto extends InsightAnalyticsBlockDto {
  @ApiProperty({ description: 'Bucket key; null when the dimension was not captured for that row.' })
  key!: string | null;
}

export class InsightAnalyticsResponseDto {
  @ApiProperty()
  orgId!: string;

  @ApiProperty({ type: InsightAnalyticsBlockDto })
  totals!: InsightAnalyticsBlockDto;

  @ApiProperty({ type: [InsightAnalyticsBucketDto], description: 'Breakdown by InsightType.' })
  byInsightType!: InsightAnalyticsBucketDto[];

  @ApiProperty({ type: [InsightAnalyticsBucketDto], description: 'Breakdown by InsightPriority band.' })
  byPriority!: InsightAnalyticsBucketDto[];

  @ApiProperty({ type: [InsightAnalyticsBucketDto], description: 'Breakdown by Platform.' })
  byPlatform!: InsightAnalyticsBucketDto[];

  @ApiProperty({ type: [InsightAnalyticsBucketDto], description: 'Breakdown by relatedActionType.' })
  byActionType!: InsightAnalyticsBucketDto[];

  @ApiProperty({ type: [InsightAnalyticsBucketDto], description: 'Breakdown by user.' })
  byUser!: InsightAnalyticsBucketDto[];

  @ApiProperty()
  generatedAt!: string;
}

export class InsightRuleAnalyticsBucketDto extends InsightAnalyticsBlockDto {
  @ApiProperty({ description: 'Source rule id; bucket only contains rows whose relatedRuleId matches.' })
  ruleId!: string;
}

export class InsightRulesAnalyticsResponseDto {
  @ApiProperty()
  orgId!: string;

  @ApiProperty({ type: [InsightRuleAnalyticsBucketDto] })
  rules!: InsightRuleAnalyticsBucketDto[];

  @ApiProperty({ description: 'Rows that have feedback / status but no relatedRuleId (e.g. trend insights).' })
  uncategorizedCount!: number;

  @ApiProperty()
  generatedAt!: string;
}

// ─── Admin (cross-org) shape ────────────────────────────────────────────────

export class InsightAdminAnalyticsBucketDto extends InsightAnalyticsBlockDto {
  @ApiProperty()
  orgId!: string;
}

export class InsightAdminAnalyticsResponseDto {
  @ApiProperty({ type: InsightAnalyticsBlockDto, description: 'Cross-org totals.' })
  totals!: InsightAnalyticsBlockDto;

  @ApiProperty({ type: [InsightAdminAnalyticsBucketDto] })
  byOrg!: InsightAdminAnalyticsBucketDto[];

  @ApiProperty({ type: [InsightAnalyticsBucketDto] })
  byInsightType!: InsightAnalyticsBucketDto[];

  @ApiProperty({ type: [InsightAnalyticsBucketDto] })
  byPlatform!: InsightAnalyticsBucketDto[];

  @ApiProperty()
  generatedAt!: string;
}

// Internal: shape an aggregator returns. Strongly typed so the service can
// build ratios in one place. Exported so analytics tests can assert it.
export interface InsightAnalyticsBlock {
  interactionCount: number;
  withStatusCount: number;
  withFeedbackCount: number;
  statusCounts: Record<InsightInteractionStatus, number>;
  feedbackCounts: Record<InsightFeedback, number>;
  rates: {
    seenRate: number;
    dismissedRate: number;
    savedRate: number;
    usefulRate: number;
    notUsefulRate: number;
    wrongRate: number;
    needsMoreContextRate: number;
  };
}

// Type-check helpers so the bucket-key type discipline can't drift across files.
export type ActionTypeOrNull = ActionType | null;
export type PlatformOrNull = Platform | null;
