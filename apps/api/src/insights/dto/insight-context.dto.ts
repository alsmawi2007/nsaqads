import { ApiProperty } from '@nestjs/swagger';
import { ActionType, Platform } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

// Optional metadata the dashboard may include when recording lifecycle /
// feedback. The frontend already has these fields on the InsightDto it just
// rendered, so passing them costs nothing and lets analytics aggregate by
// rule, type, platform, etc. without re-deriving the (ephemeral) insight.
export class InsightContextDto {
  @ApiProperty({ required: false, description: 'InsightType enum value, e.g. OPTIMIZATION_OPPORTUNITY.' })
  @IsOptional() @IsString() @MaxLength(64)
  insightType?: string;

  @ApiProperty({ required: false, description: 'InsightSeverity (INFO/LOW/MEDIUM/HIGH).' })
  @IsOptional() @IsString() @MaxLength(16)
  severity?: string;

  @ApiProperty({ required: false, description: 'InsightPriority band (LOW/MEDIUM/HIGH/CRITICAL).' })
  @IsOptional() @IsString() @MaxLength(16)
  priority?: string;

  @ApiProperty({ required: false, description: 'Source rule id when the insight derives from a single rule.' })
  @IsOptional() @IsString() @MaxLength(64)
  relatedRuleId?: string;

  @ApiProperty({
    required: false,
    enum: ['INCREASE_BUDGET', 'DECREASE_BUDGET', 'SWITCH_BIDDING_STRATEGY', 'ADJUST_BID_CEILING', 'ADJUST_BID_FLOOR'],
  })
  @IsOptional() @IsEnum(ActionType)
  relatedActionType?: ActionType;

  @ApiProperty({ required: false, enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  @IsOptional() @IsEnum(Platform)
  platform?: Platform;

  @ApiProperty({ required: false, enum: ['CAMPAIGN', 'AD_SET'] })
  @IsOptional() @IsString() @MaxLength(16)
  entityType?: 'CAMPAIGN' | 'AD_SET';

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(64)
  entityId?: string;
}
