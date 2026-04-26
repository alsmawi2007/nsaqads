import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Platform } from '@prisma/client';
import { BiddingStrategy } from '../../providers/interfaces/ad-provider.interface';

export class EditPlanItemDto {
  @ApiProperty({ description: 'Existing CampaignPlanItem id being edited.' })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: Platform })
  @IsEnum(Platform)
  platform: Platform;

  @ApiPropertyOptional({ example: 'CONVERSIONS' })
  @IsOptional()
  @IsString()
  objective?: string;

  @ApiPropertyOptional({ example: 750 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  dailyBudget?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isCbo?: boolean;

  @ApiPropertyOptional({ enum: BiddingStrategy })
  @IsOptional()
  @IsEnum(BiddingStrategy)
  biddingStrategy?: BiddingStrategy;

  @ApiPropertyOptional({
    description: 'Cost-cap / bid-cap target; required when biddingStrategy is COST_CAP or BID_CAP.',
    example: 25,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  bidTarget?: number;
}

export class EditPlanDto {
  @ApiProperty({ type: [EditPlanItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EditPlanItemDto)
  items: EditPlanItemDto[];
}
