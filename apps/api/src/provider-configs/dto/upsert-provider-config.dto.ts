import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

// Body for PUT /admin/provider-configs/:platform.
//
// Secrets are write-only — they're never returned by GET endpoints.
// On update, omitting `appSecret` or `oauthStateSecret` keeps the existing
// stored value (so admins can edit non-secret fields without re-entering
// secrets each time). On create, both are required.
export class UpsertProviderConfigDto {
  @ApiPropertyOptional({ description: 'Toggle without changing other fields. Default: false on create.' })
  @IsOptional() @IsBoolean()
  isEnabled?: boolean;

  @ApiProperty({ example: '1234567890', description: 'Public app id (numeric for Meta, alphanumeric for others).' })
  @IsString() @MinLength(1)
  appId!: string;

  @ApiPropertyOptional({ description: 'AES-256-GCM encrypted at rest. Required on create; omit on edit to keep existing.' })
  @IsOptional() @IsString() @MinLength(8)
  appSecret?: string;

  @ApiProperty({
    example: 'https://api.nsqads.ai/api/v1/providers/meta/oauth/callback',
    description: 'Must be byte-identical to the URI whitelisted in the platform app console.',
  })
  @IsString() @MinLength(1)
  redirectUri!: string;

  @ApiPropertyOptional({ description: 'Required on create; omit on edit to keep existing.' })
  @IsOptional() @IsString() @MinLength(16)
  oauthStateSecret?: string;

  @ApiPropertyOptional({ example: 'v21.0', description: 'Platform-specific API version. e.g. Meta: v21.0, TikTok: v1.3.' })
  @IsOptional() @IsString()
  apiVersion?: string;

  @ApiPropertyOptional({
    description: 'Per-request OAuth scopes. Empty for platforms with app-level scopes (e.g. TikTok).',
    example: ['ads_management', 'ads_read', 'business_management'],
  })
  @IsOptional() @IsArray() @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Free-form platform-specific NON-secret metadata (e.g. Google Ads loginCustomerId).' })
  @IsOptional() @IsObject()
  extra?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Platform-specific SENSITIVE credentials, encrypted at rest (e.g. Google Ads developerToken). ' +
      'Write-only: GET returns key names only. Omit on edit to keep existing values.',
    example: { developerToken: 'abc123XYZ-developer-token' },
  })
  @IsOptional() @IsObject()
  extraSecrets?: Record<string, string>;
}
