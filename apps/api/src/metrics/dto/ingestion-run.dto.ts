import { ApiProperty } from '@nestjs/swagger';
import { Platform } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

// ─── Request ─────────────────────────────────────────────────────────────────

export class MetricsIngestionRunRequestDto {
  @ApiProperty({
    required: false,
    description: 'Limit the run to a single org. Omit to run across every active org.',
  })
  @IsOptional()
  @IsUUID()
  orgId?: string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'When true, list the entities that would be ingested without calling any provider.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({
    required: false,
    description: 'Free-form note recorded on the audit log for this manual run (operator initials, ticket id, etc.).',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

// ─── Per-entity result ───────────────────────────────────────────────────────

export class MetricsIngestionEntityResultDto {
  @ApiProperty() orgId!: string;
  @ApiProperty() adAccountId!: string;
  @ApiProperty({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  platform!: Platform;
  @ApiProperty({ enum: ['CAMPAIGN', 'AD_SET'] })
  entityType!: 'CAMPAIGN' | 'AD_SET';
  @ApiProperty() entityId!: string;
  @ApiProperty() externalId!: string;
  @ApiProperty({ description: 'true when ingestForEntity returned without throwing.' })
  succeeded!: boolean;
  @ApiProperty({ nullable: true, description: 'Error message if ingestion threw. Null on success.' })
  errorMessage!: string | null;
  @ApiProperty({ description: 'Duration in milliseconds spent ingesting this single entity.' })
  durationMs!: number;
}

// ─── Run summary ─────────────────────────────────────────────────────────────

export class MetricsIngestionPlatformBreakdownDto {
  @ApiProperty({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  platform!: Platform;
  @ApiProperty() totalEntities!: number;
  @ApiProperty() succeededCount!: number;
  @ApiProperty() failedCount!: number;
}

export class MetricsIngestionRunResultDto {
  @ApiProperty({ description: 'Stable id correlating audit_logs.afterState.runId with this response.' })
  runId!: string;

  @ApiProperty({ description: 'ISO timestamp when the run started.' })
  startedAt!: string;

  @ApiProperty({ description: 'ISO timestamp when the run finished.' })
  finishedAt!: string;

  @ApiProperty({ description: 'Total wall-clock milliseconds from start to finish.' })
  durationMs!: number;

  @ApiProperty({ enum: ['SCHEDULER', 'MANUAL'] })
  triggeredBy!: 'SCHEDULER' | 'MANUAL';

  @ApiProperty({ description: 'true when the request was a dry run (no provider calls, no DB writes).' })
  dryRun!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Org ids included in this run. Length 1 for org-scoped runs, N for the all-orgs sweep.',
  })
  orgIds!: string[];

  @ApiProperty() totalEntities!: number;
  @ApiProperty() succeededCount!: number;
  @ApiProperty() failedCount!: number;

  @ApiProperty({ type: [MetricsIngestionPlatformBreakdownDto] })
  perPlatform!: MetricsIngestionPlatformBreakdownDto[];

  @ApiProperty({
    type: [MetricsIngestionEntityResultDto],
    description: 'Per-entity outcomes. Bounded — see runnerService for caps.',
  })
  entities!: MetricsIngestionEntityResultDto[];
}

// ─── Observability ───────────────────────────────────────────────────────────

export class MetricsIngestionAccountFreshnessDto {
  @ApiProperty() orgId!: string;
  @ApiProperty() adAccountId!: string;
  @ApiProperty({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  platform!: Platform;
  @ApiProperty() adAccountName!: string;
  @ApiProperty({ description: 'Number of campaigns linked to this ad account, soft-deletes excluded.' })
  campaignCount!: number;
  @ApiProperty({
    nullable: true,
    description: 'Most recent metric_snapshots.created_at for any campaign on this ad account. Null when nothing has been ingested.',
  })
  lastIngestedAt!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Whole minutes since lastIngestedAt. Null when no snapshot exists.',
  })
  minutesSinceLastIngestion!: number | null;
}

export class MetricsIngestionRecentRunDto {
  @ApiProperty() runId!: string;
  @ApiProperty() startedAt!: string;
  @ApiProperty() finishedAt!: string;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ enum: ['SCHEDULER', 'MANUAL'] })
  triggeredBy!: 'SCHEDULER' | 'MANUAL';
  @ApiProperty() dryRun!: boolean;
  @ApiProperty() totalEntities!: number;
  @ApiProperty() succeededCount!: number;
  @ApiProperty() failedCount!: number;
  @ApiProperty({ type: [String] }) orgIds!: string[];
}

export class MetricsIngestionObservabilityDto {
  @ApiProperty({
    description: 'metrics.ingestion_enabled — when false the scheduler skips every cycle.',
  })
  ingestionEnabled!: boolean;

  @ApiProperty({
    description: 'metrics.ingestion_interval_hours — the scheduler ingests at most once per this interval.',
  })
  intervalHours!: number;

  @ApiProperty({
    nullable: true,
    description: 'startedAt of the most recent run logged via audit_logs (any trigger). Null when nothing has run.',
  })
  lastRunAt!: string | null;

  @ApiProperty({
    type: [MetricsIngestionRecentRunDto],
    description: 'Most recent runs, newest first. Capped at 20.',
  })
  recentRuns!: MetricsIngestionRecentRunDto[];

  @ApiProperty({
    type: [MetricsIngestionAccountFreshnessDto],
    description: 'Per-ad-account freshness derived from MAX(metric_snapshots.created_at). Capped at 100.',
  })
  perAccountFreshness!: MetricsIngestionAccountFreshnessDto[];

  @ApiProperty({ description: 'ISO timestamp when this response was assembled.' })
  generatedAt!: string;
}
