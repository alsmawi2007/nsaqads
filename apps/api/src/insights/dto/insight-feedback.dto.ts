import { ApiProperty } from '@nestjs/swagger';
import { InsightFeedback } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { InsightContextDto } from './insight-context.dto';

export class InsightFeedbackDto {
  @ApiProperty({
    enum: ['USEFUL', 'NOT_USEFUL', 'WRONG', 'NEEDS_MORE_CONTEXT'],
    description: 'Caller’s verdict on the insight.',
  })
  @IsEnum({ USEFUL: 'USEFUL', NOT_USEFUL: 'NOT_USEFUL', WRONG: 'WRONG', NEEDS_MORE_CONTEXT: 'NEEDS_MORE_CONTEXT' })
  feedback!: InsightFeedback;

  @ApiProperty({ required: false, maxLength: 2000, description: 'Optional free-text note. Replaces any prior note when present.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ required: false, type: () => InsightContextDto, description: 'Insight metadata snapshot for analytics aggregation.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InsightContextDto)
  context?: InsightContextDto;
}

// Body accepted by /seen, /dismiss, /save when the client wants to attach
// metadata for analytics. Always optional — empty body is still valid.
export class InsightStatusBodyDto {
  @ApiProperty({ required: false, type: () => InsightContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InsightContextDto)
  context?: InsightContextDto;
}
