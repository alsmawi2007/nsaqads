import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ApprovePlanDto {
  @ApiProperty({
    description:
      'Operator must explicitly acknowledge outstanding warnings before approval. ' +
      'If warnings exist in the plan and this is false, the approve request is rejected.',
    example: false,
  })
  @IsBoolean()
  acknowledgedWarnings: boolean;
}
