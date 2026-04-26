import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CampaignPlanItemLaunchStatus,
  Platform,
} from '@prisma/client';

export class PlanItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  planId: string;

  @ApiProperty({ enum: Platform })
  platform: Platform;

  @ApiProperty({ description: 'Adari internal AdAccount UUID.' })
  adAccountId: string;

  @ApiProperty({ example: 'CONVERSIONS' })
  objective: string;

  @ApiProperty({ description: 'Daily budget in the plan currency.', example: 500 })
  dailyBudget: number;

  @ApiProperty({ example: false })
  isCbo: boolean;

  @ApiProperty({ description: 'Normalized BiddingStrategy enum value.', example: 'LOWEST_COST' })
  biddingStrategy: string;

  @ApiPropertyOptional({
    description: 'Cost-cap / bid-cap target when biddingStrategy requires it.',
    example: 25,
    nullable: true,
  })
  bidTarget: number | null;

  @ApiProperty({
    type: Object,
    description: 'Normalized audience payload (countries, ages, genders, interests, etc.).',
  })
  audience: Record<string, unknown>;

  @ApiProperty({
    type: Object,
    description: 'Creative reference payload (assetRefs, headline, cta, landingUrl, etc.).',
  })
  creativeRef: Record<string, unknown>;

  @ApiProperty({ enum: CampaignPlanItemLaunchStatus })
  launchStatus: CampaignPlanItemLaunchStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Provider-side campaign id assigned after successful launch.',
  })
  externalCampaignId: string | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description: 'Provider-side ad set ids assigned after successful launch.',
  })
  externalAdsetIds: string[] | null;

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  launchedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}
