import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, Matches, IsOptional } from 'class-validator';

export class CreateOrgDto {
  @ApiProperty({ example: 'Acme Agency' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'acme-agency', description: 'URL-friendly unique identifier' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase alphanumeric with hyphens only' })
  slug: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
