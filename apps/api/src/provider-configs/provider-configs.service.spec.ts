import { Platform } from '@prisma/client';
import { ProviderConfigsService } from './provider-configs.service';
import { ProviderError, ProviderErrorKind } from '../providers/shared/provider-error';

// Sets a deterministic 32-byte hex key for the AES-256-GCM helper.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Captures encrypted ciphertexts in-memory so we can assert the service
// stores the encrypted value, not the plaintext.
class FakePrisma {
  rows = new Map<Platform, any>();

  providerConfig = {
    findUnique: async ({ where: { platform } }: { where: { platform: Platform } }) => {
      return this.rows.get(platform) ?? null;
    },
    findMany: async () => Array.from(this.rows.values()),
    upsert: async ({ where, update, create }: any) => {
      const existing = this.rows.get(where.platform);
      const payload = existing ? { ...existing, ...update } : { ...create };
      const row = {
        id: existing?.id ?? `cfg-${where.platform}`,
        keyVersion: 1,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
        ...payload,
      };
      this.rows.set(where.platform, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const existing = this.rows.get(where.platform);
      if (!existing) throw new Error('not found');
      const row = { ...existing, ...data, updatedAt: new Date() };
      this.rows.set(where.platform, row);
      return row;
    },
    delete: async ({ where }: any) => {
      const existing = this.rows.get(where.platform);
      this.rows.delete(where.platform);
      return existing;
    },
  };
}

const audit = { log: jest.fn().mockResolvedValue(undefined) };

function makeService() {
  const prisma = new FakePrisma();
  const service = new ProviderConfigsService(prisma as never, audit as never);
  return { prisma, service };
}

const validDto = {
  appId: '1234567890',
  appSecret: 'meta-app-secret-plaintext',
  redirectUri: 'https://api.nsqads.ai/api/v1/providers/meta/oauth/callback',
  oauthStateSecret: 'state-signing-secret-min-16-chars',
  apiVersion: 'v21.0',
  scopes: ['ads_management', 'ads_read', 'business_management'],
};

describe('ProviderConfigsService', () => {
  beforeEach(() => {
    audit.log.mockClear();
    delete process.env.PUBLIC_API_BASE_URL;
  });

  it('getEnabled throws VALIDATION when no row exists', async () => {
    const { service } = makeService();
    await expect(service.getEnabled(Platform.META)).rejects.toMatchObject({
      kind: ProviderErrorKind.VALIDATION,
      platform: Platform.META,
    });
  });

  it('getEnabled throws VALIDATION when row exists but isEnabled=false', async () => {
    const { service } = makeService();
    await service.upsert(Platform.META, { ...validDto, isEnabled: false }, 'user-1');
    await expect(service.getEnabled(Platform.META)).rejects.toBeInstanceOf(ProviderError);
  });

  it('getEnabled returns decrypted secrets when row enabled', async () => {
    const { service, prisma } = makeService();
    await service.upsert(Platform.META, { ...validDto, isEnabled: true }, 'user-1');

    const cfg = await service.getEnabled(Platform.META);
    expect(cfg.appId).toBe(validDto.appId);
    expect(cfg.appSecret).toBe(validDto.appSecret);
    expect(cfg.oauthStateSecret).toBe(validDto.oauthStateSecret);
    expect(cfg.scopes).toEqual(validDto.scopes);
    // Sanity: stored ciphertexts must NOT equal plaintext.
    const row = prisma.rows.get(Platform.META);
    expect(row.appSecretCipher).not.toBe(validDto.appSecret);
    expect(row.oauthStateSecretCipher).not.toBe(validDto.oauthStateSecret);
  });

  it('getRedacted never exposes plaintext secrets', async () => {
    const { service } = makeService();
    await service.upsert(Platform.META, { ...validDto, isEnabled: true }, 'user-1');
    const r = await service.getRedacted(Platform.META);
    expect(r).not.toBeNull();
    expect((r as any).appSecret).toBeUndefined();
    expect((r as any).oauthStateSecret).toBeUndefined();
    expect(r!.hasAppSecret).toBe(true);
    expect(r!.hasOauthStateSecret).toBe(true);
    expect(r!.appSecretLast4).toMatch(/text$/);
  });

  it('upsert without secrets on edit keeps existing ciphertext', async () => {
    const { service, prisma } = makeService();
    await service.upsert(Platform.META, { ...validDto, isEnabled: true }, 'user-1');
    const cipherBefore = prisma.rows.get(Platform.META).appSecretCipher;

    await service.upsert(Platform.META, {
      appId: '999',
      redirectUri: validDto.redirectUri,
      isEnabled: true,
      apiVersion: 'v22.0',
    }, 'user-2');

    const row = prisma.rows.get(Platform.META);
    expect(row.appId).toBe('999');
    expect(row.apiVersion).toBe('v22.0');
    expect(row.appSecretCipher).toBe(cipherBefore);
  });

  it('upsert on create requires both secrets', async () => {
    const { service } = makeService();
    await expect(
      service.upsert(Platform.META, {
        appId: 'x',
        redirectUri: validDto.redirectUri,
      } as never, 'user-1'),
    ).rejects.toThrow(/appSecret/i);
  });

  it('rejects redirectUri that does not start with PUBLIC_API_BASE_URL', async () => {
    process.env.PUBLIC_API_BASE_URL = 'https://api.nsqads.ai';
    const { service } = makeService();
    await expect(
      service.upsert(Platform.META, {
        ...validDto,
        redirectUri: 'https://attacker.example/callback',
      }, 'user-1'),
    ).rejects.toThrow(/PUBLIC_API_BASE_URL/);
  });

  it('rejects http:// redirectUri', async () => {
    const { service } = makeService();
    await expect(
      service.upsert(Platform.META, {
        ...validDto,
        redirectUri: 'http://insecure.local/callback',
      }, 'user-1'),
    ).rejects.toThrow(/https/);
  });

  it('upsert + setEnabled + delete each emit an audit log', async () => {
    const { service } = makeService();
    await service.upsert(Platform.META, { ...validDto, isEnabled: false }, 'user-1');
    await service.setEnabled(Platform.META, true, 'user-2');
    await service.delete(Platform.META, 'user-3');
    const actions = audit.log.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual([
      'provider_config.create',
      'provider_config.toggle',
      'provider_config.delete',
    ]);
  });

  it('cache invalidates on upsert (rotated secret takes effect)', async () => {
    const { service } = makeService();
    await service.upsert(Platform.META, { ...validDto, isEnabled: true }, 'user-1');
    const before = await service.getEnabled(Platform.META);
    expect(before.appSecret).toBe(validDto.appSecret);

    await service.upsert(Platform.META, {
      ...validDto,
      appSecret: 'rotated-secret-value',
    }, 'user-2');

    const after = await service.getEnabled(Platform.META);
    expect(after.appSecret).toBe('rotated-secret-value');
  });

  // ─── extraSecrets (Google Ads developerToken etc.) ────────────────────────
  it('extraSecrets are encrypted at rest and decrypted on getEnabled', async () => {
    const { service, prisma } = makeService();
    await service.upsert(
      Platform.GOOGLE_ADS,
      {
        appId: 'g-client-id.apps.googleusercontent.com',
        appSecret: 'g-secret',
        redirectUri: 'https://api.nsqads.ai/api/v1/providers/google-ads/oauth/callback',
        oauthStateSecret: 'state-signing-secret-min-16-chars',
        apiVersion: 'v18',
        isEnabled: true,
        extra: { loginCustomerId: '1234567890' },
        extraSecrets: { developerToken: 'abc123-developer-token' },
      },
      'user-1',
    );

    const row = prisma.rows.get(Platform.GOOGLE_ADS);
    // ciphertext must not equal plaintext
    expect(row.extraSecretsCipher).toBeTruthy();
    expect(row.extraSecretsCipher).not.toContain('abc123-developer-token');

    const cfg = await service.getEnabled(Platform.GOOGLE_ADS);
    expect(cfg.extraSecrets?.developerToken).toBe('abc123-developer-token');
    // plaintext extra survives unchanged
    expect((cfg.extra as any).loginCustomerId).toBe('1234567890');
  });

  it('extraSecrets merge: editing one key keeps the others intact', async () => {
    const { service } = makeService();
    await service.upsert(
      Platform.GOOGLE_ADS,
      {
        appId: 'g',
        appSecret: 'g-secret',
        redirectUri: 'https://api.nsqads.ai/cb',
        oauthStateSecret: 'state-signing-secret-min-16-chars',
        isEnabled: true,
        extraSecrets: { developerToken: 'token-a', extraThing: 'thing-a' },
      },
      'user-1',
    );

    // rotate ONLY developerToken; extraThing must be preserved.
    await service.upsert(
      Platform.GOOGLE_ADS,
      {
        appId: 'g',
        redirectUri: 'https://api.nsqads.ai/cb',
        extraSecrets: { developerToken: 'token-b' },
      },
      'user-2',
    );

    const cfg = await service.getEnabled(Platform.GOOGLE_ADS);
    expect(cfg.extraSecrets?.developerToken).toBe('token-b');
    expect(cfg.extraSecrets?.extraThing).toBe('thing-a');
  });

  it('redacted view exposes extraSecretKeys but never values', async () => {
    const { service } = makeService();
    await service.upsert(
      Platform.GOOGLE_ADS,
      {
        appId: 'g',
        appSecret: 'g-secret',
        redirectUri: 'https://api.nsqads.ai/cb',
        oauthStateSecret: 'state-signing-secret-min-16-chars',
        isEnabled: true,
        extraSecrets: { developerToken: 'should-never-leak' },
      },
      'user-1',
    );
    const r = await service.getRedacted(Platform.GOOGLE_ADS);
    expect(r!.extraSecretKeys).toEqual(['developerToken']);
    // No "extraSecrets" object on redacted shape.
    expect((r as any).extraSecrets).toBeUndefined();
    // Belt+suspenders: stringified row contains no plaintext.
    expect(JSON.stringify(r)).not.toContain('should-never-leak');
  });
});
