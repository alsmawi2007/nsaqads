import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { Platform } from '@prisma/client';
import { InsightSeverity, InsightType } from './insight.dto';

export class InsightQueryDto {
  @ApiPropertyOptional({ enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  @IsOptional()
  @IsIn(['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'])
  platform?: Platform;

  @ApiPropertyOptional({ enum: InsightSeverity })
  @IsOptional()
  @IsEnum(InsightSeverity)
  severity?: InsightSeverity;

  @ApiPropertyOptional({ enum: InsightType })
  @IsOptional()
  @IsEnum(InsightType)
  insightType?: InsightType;

  // Reserved: filters insights by the metric window they were derived from.
  // Today the evaluator blends 24h/48h/72h via recency weighting, so this
  // value is accepted but does not narrow results yet.
  @ApiPropertyOptional({ enum: ['24', '48', '72'], description: 'Reserved — accepted but currently a no-op.' })
  @IsOptional()
  @IsIn(['24', '48', '72'])
  window?: '24' | '48' | '72';
}
