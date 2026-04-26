import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum RiskSeverity {
  WARNING = 'WARNING',
  BLOCKER = 'BLOCKER',
}

export enum RiskCode {
  LOW_DAILY_BUDGET = 'LOW_DAILY_BUDGET',
  BUDGET_BELOW_PLATFORM_MINIMUM = 'BUDGET_BELOW_PLATFORM_MINIMUM',
  MISSING_CREATIVE_ASSETS = 'MISSING_CREATIVE_ASSETS',
  MISSING_LANDING_URL = 'MISSING_LANDING_URL',
  MISSING_HEADLINE = 'MISSING_HEADLINE',
  WEAK_AUDIENCE_DEFINITION = 'WEAK_AUDIENCE_DEFINITION',
  SHORT_CAMPAIGN_DURATION = 'SHORT_CAMPAIGN_DURATION',
  NO_CONVERSION_TRACKING = 'NO_CONVERSION_TRACKING',
  UNSUPPORTED_PLATFORM_FOR_GOAL = 'UNSUPPORTED_PLATFORM_FOR_GOAL',
  AD_ACCOUNT_NOT_CONNECTED = 'AD_ACCOUNT_NOT_CONNECTED',
  AD_ACCOUNT_DISCONNECTED = 'AD_ACCOUNT_DISCONNECTED',
  CURRENCY_MISMATCH = 'CURRENCY_MISMATCH',
  LIFETIME_BUDGET_WITHOUT_END_DATE = 'LIFETIME_BUDGET_WITHOUT_END_DATE',
  SINGLE_PLATFORM_CONCENTRATION = 'SINGLE_PLATFORM_CONCENTRATION',
  WEEKEND_START = 'WEEKEND_START',
}

export class RiskFindingDto {
  @ApiProperty({ enum: RiskCode })
  @IsEnum(RiskCode)
  code: RiskCode;

  @ApiProperty({ enum: RiskSeverity })
  @IsEnum(RiskSeverity)
  severity: RiskSeverity;

  @ApiProperty({ example: 'Daily budget is below the recommended minimum for META.' })
  @IsString()
  @MaxLength(500)
  message: string;

  @ApiPropertyOptional({
    description: 'Optional platform this finding applies to; absent means plan-wide.',
    example: 'META',
  })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({
    description: 'Structured context (thresholds, actual values, etc.) for UI rendering.',
    type: Object,
  })
  @IsOptional()
  context?: Record<string, unknown>;
}
