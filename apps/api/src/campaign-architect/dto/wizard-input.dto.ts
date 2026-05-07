import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BudgetType, CampaignGoal, Platform } from '@prisma/client';

export enum AudienceGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  ALL = 'ALL',
}

export enum CreativeFormat {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  CAROUSEL = 'CAROUSEL',
  COLLECTION = 'COLLECTION',
}

export class GoalDetailDto {
  @ApiPropertyOptional({
    description: 'Target CPA in account currency (SALES / LEADS).',
    example: 25,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetCpa?: number;

  @ApiPropertyOptional({
    description: 'Target ROAS multiplier (SALES).',
    example: 3.5,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetRoas?: number;

  @ApiPropertyOptional({
    description: 'Desired monthly leads (LEADS).',
    example: 200,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetLeadsPerMonth?: number;

  @ApiPropertyOptional({
    description: 'Desired monthly app installs (APP_INSTALLS).',
    example: 5000,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetInstallsPerMonth?: number;

  @ApiPropertyOptional({
    description: 'Desired unique reach (AWARENESS).',
    example: 250000,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetReach?: number;

  @ApiPropertyOptional({
    description: 'Desired landing-page visits (TRAFFIC).',
    example: 10000,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetClicks?: number;

  @ApiPropertyOptional({
    description: 'Desired engagements — likes, comments, shares (ENGAGEMENT).',
    example: 5000,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetEngagements?: number;

  @ApiPropertyOptional({
    description: 'Free-text extra context supplied by the operator.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class GeographyDto {
  @ApiProperty({
    type: [String],
    description: 'ISO-3166-1 alpha-2 country codes.',
    example: ['SA', 'AE'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  countries: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional city names; provider adapters resolve to geo IDs.',
    example: ['Riyadh', 'Dubai'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  cities?: string[];

  @ApiPropertyOptional({
    description: 'Radius in kilometers around each city (required when cities are set).',
    minimum: 1,
    maximum: 500,
    example: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  radiusKm?: number;
}

export class AudienceHintsDto {
  @ApiProperty({ minimum: 13, maximum: 65, example: 25 })
  @IsInt()
  @Min(13)
  @Max(65)
  ageMin: number;

  @ApiProperty({ minimum: 13, maximum: 65, example: 55 })
  @IsInt()
  @Min(13)
  @Max(65)
  ageMax: number;

  @ApiProperty({
    enum: AudienceGender,
    isArray: true,
    example: [AudienceGender.ALL],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(AudienceGender, { each: true })
  genders: AudienceGender[];

  @ApiPropertyOptional({
    type: [String],
    description: 'ISO-639-1 language codes.',
    example: ['ar', 'en'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Free-form interest keywords; provider adapters map to platform taxonomies.',
    example: ['fitness', 'healthy eating'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  interestTags?: string[];
}

export class BudgetDto {
  @ApiProperty({ description: 'Total campaign budget in account currency.', example: 3000 })
  @IsNumber()
  @IsPositive()
  totalBudget: number;

  @ApiProperty({ enum: BudgetType, example: BudgetType.DAILY })
  @IsEnum(BudgetType)
  budgetType: BudgetType;

  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class TimelineDto {
  @ApiProperty({ example: '2026-05-01', description: 'ISO date YYYY-MM-DD.' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-05-31', description: 'ISO date; required for LIFETIME budgets.' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class PlatformSelectionDto {
  @ApiProperty({
    enum: Platform,
    isArray: true,
    description: 'Platforms the wizard should plan for. Phase 1 supports META and GOOGLE_ADS.',
    example: [Platform.META, Platform.GOOGLE_ADS],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(Platform, { each: true })
  platforms: Platform[];

  @ApiProperty({
    type: Object,
    description:
      'Map of Platform → adAccountId (Nasaq Ads internal UUID). Must contain one entry per selected platform.',
    example: { META: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
  })
  adAccountIds: Record<string, string>;
}

export class CreativeBriefDto {
  @ApiProperty({
    enum: CreativeFormat,
    isArray: true,
    description: 'Formats the operator intends to upload.',
    example: [CreativeFormat.IMAGE, CreativeFormat.VIDEO],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(CreativeFormat, { each: true })
  formats: CreativeFormat[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Pre-existing creative asset identifiers (empty when creatives are not yet uploaded).',
    example: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  assetRefs?: string[];

  @ApiPropertyOptional({ example: 'Shop the new summer collection', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string;

  @ApiPropertyOptional({ example: 'Free shipping across the GCC.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'SHOP_NOW', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cta?: string;

  @ApiPropertyOptional({ example: 'https://example.com/landing' })
  @IsOptional()
  @IsUrl()
  landingUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether a tracking pixel / conversion API is confirmed installed on the landing domain.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  pixelInstalled?: boolean;
}

export class WizardInputDto {
  @ApiProperty({ example: 'Summer launch — GCC', minLength: 3, maxLength: 120 })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: CampaignGoal })
  @IsEnum(CampaignGoal)
  goal: CampaignGoal;

  @ApiProperty({ type: GoalDetailDto })
  @ValidateNested()
  @Type(() => GoalDetailDto)
  goalDetail: GoalDetailDto;

  @ApiProperty({ type: GeographyDto })
  @ValidateNested()
  @Type(() => GeographyDto)
  geography: GeographyDto;

  @ApiProperty({ type: AudienceHintsDto })
  @ValidateNested()
  @Type(() => AudienceHintsDto)
  audience: AudienceHintsDto;

  @ApiProperty({ type: BudgetDto })
  @ValidateNested()
  @Type(() => BudgetDto)
  budget: BudgetDto;

  @ApiProperty({ type: TimelineDto })
  @ValidateNested()
  @Type(() => TimelineDto)
  timeline: TimelineDto;

  @ApiProperty({ type: PlatformSelectionDto })
  @ValidateNested()
  @Type(() => PlatformSelectionDto)
  platformSelection: PlatformSelectionDto;

  @ApiProperty({ type: CreativeBriefDto })
  @ValidateNested()
  @Type(() => CreativeBriefDto)
  creativeBrief: CreativeBriefDto;
}
