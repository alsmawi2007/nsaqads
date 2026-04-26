import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ConfidenceLabel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum ConfidenceFactorKey {
  PIXEL_AVAILABILITY = 'PIXEL_AVAILABILITY',
  AUDIENCE_CLARITY = 'AUDIENCE_CLARITY',
  BUDGET_SUFFICIENCY = 'BUDGET_SUFFICIENCY',
}

export class ConfidenceFactorDto {
  @ApiProperty({ enum: ConfidenceFactorKey })
  @IsEnum(ConfidenceFactorKey)
  key: ConfidenceFactorKey;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Per-factor contribution to overall confidence (0–100).',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  score: number;

  @ApiProperty({ example: 'Pixel is installed on the landing domain.' })
  @IsString()
  note: string;
}

export class ConfidenceDto {
  @ApiProperty({ minimum: 0, maximum: 100, example: 72 })
  @IsInt()
  @Min(0)
  @Max(100)
  score: number;

  @ApiProperty({ enum: ConfidenceLabel })
  @IsEnum(ConfidenceLabel)
  label: ConfidenceLabel;

  @ApiProperty({ type: [ConfidenceFactorDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfidenceFactorDto)
  factors: ConfidenceFactorDto[];
}

export class StrategicSummaryDto {
  @ApiProperty({
    description: 'English strategic narrative explaining the plan in plain language.',
    example:
      'We recommend a lead-generation plan prioritizing Meta with a TOFU audience...',
  })
  @IsString()
  en: string;

  @ApiPropertyOptional({
    description: 'Arabic translation; null in Phase 1 pending localization work.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  ar?: string | null;

  @ApiProperty({ type: ConfidenceDto })
  @ValidateNested()
  @Type(() => ConfidenceDto)
  confidence: ConfidenceDto;
}
