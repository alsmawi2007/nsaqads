import { ApiProperty } from '@nestjs/swagger';
import {
  CampaignPlanItemLaunchStatus,
  CampaignPlanStatus,
  Platform,
} from '@prisma/client';

export class LaunchResultItemDto {
  @ApiProperty()
  itemId: string;

  @ApiProperty({ enum: Platform })
  platform: Platform;

  @ApiProperty({ enum: CampaignPlanItemLaunchStatus })
  launchStatus: CampaignPlanItemLaunchStatus;

  @ApiProperty({ nullable: true })
  externalCampaignId: string | null;

  @ApiProperty({ type: [String], nullable: true })
  externalAdsetIds: string[] | null;

  @ApiProperty({ nullable: true })
  externalCreativeId: string | null;

  @ApiProperty({ nullable: true })
  externalAdId: string | null;

  @ApiProperty({ nullable: true })
  errorMessage: string | null;

  @ApiProperty({ nullable: true })
  launchedAt: string | null;
}

export class LaunchProgressSummaryDto {
  @ApiProperty({ description: 'Items processed (CREATED+FAILED+SKIPPED) / total, 0-100' })
  progressPct: number;

  @ApiProperty({ description: 'CREATED / total, 0-100' })
  successRate: number;

  @ApiProperty({ description: 'Wall-clock duration of the launch in ms' })
  durationMs: number;

  @ApiProperty({ description: 'Human-readable summary line' })
  message: string;
}

export class LaunchResultDto {
  @ApiProperty()
  planId: string;

  @ApiProperty({ enum: CampaignPlanStatus })
  planStatus: CampaignPlanStatus;

  @ApiProperty({ nullable: true })
  launchedAt: string | null;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  createdCount: number;

  @ApiProperty()
  failedCount: number;

  @ApiProperty()
  skippedCount: number;

  @ApiProperty({ type: LaunchProgressSummaryDto })
  summary: LaunchProgressSummaryDto;

  @ApiProperty({ type: [LaunchResultItemDto] })
  items: LaunchResultItemDto[];
}
