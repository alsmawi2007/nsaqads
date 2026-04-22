import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { Platform } from '@prisma/client';

export class ConnectAdAccountDto {
  @ApiProperty({ enum: Platform })
  @IsEnum(Platform)
  platform: Platform;

  @ApiProperty({ example: 'act_123456789', description: 'Platform account ID' })
  @IsString()
  externalId: string;

  @ApiProperty({ example: 'My Meta Ad Account', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'SAR', required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: 'Provider access token (will be encrypted at rest)' })
  @IsString()
  accessToken: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
