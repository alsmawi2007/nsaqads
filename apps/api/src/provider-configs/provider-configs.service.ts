import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Platform, Prisma, ProviderConfig as ProviderConfigRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { encrypt, decrypt } from '../common/utils/crypto.util';
import { ProviderError, ProviderErrorKind } from '../providers/shared/provider-error';
import { UpsertProviderConfigDto } from './dto/upsert-provider-config.dto';
import {
  RedactedProviderConfig,
  ResolvedProviderConfig,
} from './provider-config.types';

// ProviderConfigsService is the single source of truth for provider-specific
// OAuth + API credentials at runtime. There is NO env fallback — if a
// platform has no row or isEnabled=false, getEnabled() throws VALIDATION
// and the OAuth flow refuses to start.
//
// Cache: small in-memory map with 60s TTL. Invalidated on any write so
// rotated secrets become live within one cycle. Cache holds DECRYPTED
// values to keep hot paths (token refresh) cheap; map is process-local
// and never serialized.
@Injectable()
export class ProviderConfigsService {
  private readonly logger = new Logger(ProviderConfigsService.name);
  private readonly cache = new Map<Platform, { value: ResolvedProviderConfig; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─── Read paths ───────────────────────────────────────────────────────────

  // Hot path for OAuth + API client. Throws VALIDATION if not configured —
  // intentional, callers must surface a clean error to the admin UI.
  async getEnabled(platform: Platform): Promise<ResolvedProviderConfig> {
    const cached = this.cache.get(platform);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.providerConfig.findUnique({ where: { platform } });
    if (!row) {
      throw new ProviderError(
        ProviderErrorKind.VALIDATION,
        platform,
        `Provider ${platform} is not configured. Set credentials via the System Admin → Providers dashboard.`,
      );
    }
    if (!row.isEnabled) {
      throw new ProviderError(
        ProviderErrorKind.VALIDATION,
        platform,
        `Provider ${platform} is configured but disabled. Enable it via the System Admin → Providers dashboard.`,
      );
    }

    const resolved = this.toResolved(row);
    this.cache.set(platform, { value: resolved, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return resolved;
  }

  // Admin GET — secrets stripped to presence flags + last-4 fingerprint.
  async getRedacted(platform: Platform): Promise<RedactedProviderConfig | null> {
    const row = await this.prisma.providerConfig.findUnique({ where: { platform } });
    return row ? this.toRedacted(row) : null;
  }

  async listAllRedacted(): Promise<RedactedProviderConfig[]> {
    const rows = await this.prisma.providerConfig.findMany({ orderBy: { platform: 'asc' } });
    return rows.map((r) => this.toRedacted(r));
  }

  // ─── Write paths ──────────────────────────────────────────────────────────

  async upsert(
    platform: Platform,
    dto: UpsertProviderConfigDto,
    userId: string,
  ): Promise<RedactedProviderConfig> {
    this.validateRedirectUri(dto.redirectUri, platform);

    const existing = await this.prisma.providerConfig.findUnique({ where: { platform } });

    // On create, both secrets are required. On edit, missing means keep
    // existing — admins shouldn't have to re-enter every secret to flip a flag.
    if (!existing) {
      if (!dto.appSecret) {
        throw new BadRequestException('appSecret is required when creating a provider config');
      }
      if (!dto.oauthStateSecret) {
        throw new BadRequestException('oauthStateSecret is required when creating a provider config');
      }
    }

    // ExtraSecrets handling: merge with existing decrypted bag, then re-encrypt.
    // This lets admins update one secret without re-entering all of them.
    const mergedExtraSecretsCipher = this.mergeExtraSecrets(
      existing?.extraSecretsCipher ?? null,
      dto.extraSecrets,
    );

    const data: Prisma.ProviderConfigUncheckedCreateInput = {
      platform,
      isEnabled:              dto.isEnabled ?? existing?.isEnabled ?? false,
      appId:                  dto.appId,
      appSecretCipher:        dto.appSecret ? encrypt(dto.appSecret) : (existing?.appSecretCipher ?? ''),
      redirectUri:            dto.redirectUri,
      oauthStateSecretCipher: dto.oauthStateSecret ? encrypt(dto.oauthStateSecret) : (existing?.oauthStateSecretCipher ?? ''),
      apiVersion:             dto.apiVersion ?? existing?.apiVersion ?? null,
      scopes:                 dto.scopes ?? existing?.scopes ?? [],
      extra:                  (dto.extra ?? existing?.extra ?? null) as Prisma.InputJsonValue | undefined,
      extraSecretsCipher:     mergedExtraSecretsCipher,
      updatedById:            userId,
    };

    const row = await this.prisma.providerConfig.upsert({
      where: { platform },
      update: data,
      create: data,
    });

    this.cache.delete(platform);

    await this.audit.log({
      userId,
      action: existing ? 'provider_config.update' : 'provider_config.create',
      resourceType: 'ProviderConfig',
      resourceId: row.id,
      beforeState: existing ? this.maskedSnapshot(existing) : undefined,
      afterState: this.maskedSnapshot(row),
    });

    this.logger.log(`ProviderConfig ${existing ? 'updated' : 'created'}: platform=${platform} enabled=${row.isEnabled}`);
    return this.toRedacted(row);
  }

  async setEnabled(platform: Platform, isEnabled: boolean, userId: string): Promise<RedactedProviderConfig> {
    const existing = await this.prisma.providerConfig.findUnique({ where: { platform } });
    if (!existing) throw new NotFoundException(`Provider ${platform} has no config to enable/disable`);

    const row = await this.prisma.providerConfig.update({
      where: { platform },
      data: { isEnabled, updatedById: userId },
    });

    this.cache.delete(platform);

    await this.audit.log({
      userId,
      action: 'provider_config.toggle',
      resourceType: 'ProviderConfig',
      resourceId: row.id,
      beforeState: { isEnabled: existing.isEnabled },
      afterState:  { isEnabled: row.isEnabled },
    });
    return this.toRedacted(row);
  }

  async delete(platform: Platform, userId: string): Promise<void> {
    const existing = await this.prisma.providerConfig.findUnique({ where: { platform } });
    if (!existing) throw new NotFoundException(`Provider ${platform} has no config to delete`);

    await this.prisma.providerConfig.delete({ where: { platform } });
    this.cache.delete(platform);

    await this.audit.log({
      userId,
      action: 'provider_config.delete',
      resourceType: 'ProviderConfig',
      resourceId: existing.id,
      beforeState: this.maskedSnapshot(existing),
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private validateRedirectUri(redirectUri: string, platform: Platform): void {
    let url: URL;
    try { url = new URL(redirectUri); } catch {
      throw new BadRequestException('redirectUri must be a valid absolute URL');
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException('redirectUri must use https:// — provider OAuth flows reject http in production');
    }

    // If PUBLIC_API_BASE_URL is set in env, redirect URIs must live under it.
    // This prevents an attacker with admin creds from redirecting OAuth to
    // an attacker-controlled host. If unset, skip — local dev convenience.
    const base = process.env.PUBLIC_API_BASE_URL;
    if (base && !redirectUri.startsWith(base)) {
      throw new BadRequestException(
        `redirectUri for ${platform} must start with PUBLIC_API_BASE_URL (${base})`,
      );
    }
  }

  private toResolved(row: ProviderConfigRow): ResolvedProviderConfig {
    return {
      platform:         row.platform,
      isEnabled:        row.isEnabled,
      appId:            row.appId,
      appSecret:        decrypt(row.appSecretCipher),
      redirectUri:      row.redirectUri,
      oauthStateSecret: decrypt(row.oauthStateSecretCipher),
      apiVersion:       row.apiVersion,
      scopes:           row.scopes,
      extra:            (row.extra as Record<string, unknown> | null) ?? null,
      extraSecrets:     decryptExtraSecrets(row.extraSecretsCipher),
    };
  }

  private toRedacted(row: ProviderConfigRow): RedactedProviderConfig {
    const appSecret        = row.appSecretCipher ? safeDecrypt(row.appSecretCipher) : null;
    const oauthStateSecret = row.oauthStateSecretCipher ? safeDecrypt(row.oauthStateSecretCipher) : null;
    const extraSecrets     = decryptExtraSecrets(row.extraSecretsCipher);
    return {
      platform:              row.platform,
      isEnabled:             row.isEnabled,
      appId:                 row.appId,
      redirectUri:           row.redirectUri,
      apiVersion:            row.apiVersion,
      scopes:                row.scopes,
      extra:                 (row.extra as Record<string, unknown> | null) ?? null,
      hasAppSecret:          !!row.appSecretCipher,
      hasOauthStateSecret:   !!row.oauthStateSecretCipher,
      appSecretLast4:        appSecret ? last4(appSecret) : null,
      oauthStateSecretLast4: oauthStateSecret ? last4(oauthStateSecret) : null,
      extraSecretKeys:       extraSecrets ? Object.keys(extraSecrets) : [],
      keyVersion:            row.keyVersion,
      updatedById:           row.updatedById,
      updatedAt:             row.updatedAt.toISOString(),
      createdAt:             row.createdAt.toISOString(),
    };
  }

  // Merge dto.extraSecrets onto the existing decrypted bag and re-encrypt.
  // - undefined dto value → keep existing untouched
  // - {} dto value        → keep existing (no-op merge)
  // - { key: value }      → set/overwrite that key
  // Returns ciphertext or null when the merged bag is empty.
  private mergeExtraSecrets(
    existingCipher: string | null,
    dtoSecrets: Record<string, string> | undefined,
  ): string | null {
    if (dtoSecrets === undefined) return existingCipher;
    const existing = decryptExtraSecrets(existingCipher) ?? {};
    const merged = { ...existing, ...dtoSecrets };
    if (Object.keys(merged).length === 0) return null;
    return encrypt(JSON.stringify(merged));
  }

  private maskedSnapshot(row: ProviderConfigRow): Record<string, unknown> {
    return {
      platform:    row.platform,
      isEnabled:   row.isEnabled,
      appId:       row.appId,
      redirectUri: row.redirectUri,
      apiVersion:  row.apiVersion,
      scopes:      row.scopes,
      hasAppSecret:        !!row.appSecretCipher,
      hasOauthStateSecret: !!row.oauthStateSecretCipher,
      extraSecretKeys:     decryptExtraSecrets(row.extraSecretsCipher)
        ? Object.keys(decryptExtraSecrets(row.extraSecretsCipher) as Record<string, string>)
        : [],
    };
  }
}

function decryptExtraSecrets(cipher: string | null): Record<string, string> | null {
  if (!cipher) return null;
  try {
    const json = decrypt(cipher);
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return null;
  } catch {
    return null;
  }
}

function last4(s: string): string {
  return s.length <= 4 ? '*'.repeat(s.length) : `••••${s.slice(-4)}`;
}

// Defensive — if the DB ciphertext is corrupt or the encryption key has
// changed, do not crash a list call; the redacted view should still load
// so the admin can re-enter secrets.
function safeDecrypt(cipher: string): string | null {
  try { return decrypt(cipher); } catch { return null; }
}
