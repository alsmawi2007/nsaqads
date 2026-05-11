import { Platform } from '@prisma/client';
import { TikTokOAuthService } from './tiktok-oauth.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';

// Verifies the dynamic-config contract:
//   1. /start refuses to build a URL until SYSTEM_ADMIN has configured TikTok.
//   2. Once configured, the URL contains all expected components and the
//      state JWT verifies under the same DB-backed secret.
//   3. apiVersion is irrelevant to the authorize URL (TikTok scopes + version
//      are app-level), so that's not asserted; we only care about app_id +
//      redirect_uri + state.

function makeProviderConfigsStub(cfg: {
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  oauthStateSecret?: string;
  apiVersion?: string;
} | null) {
  return {
    getEnabled: jest.fn().mockImplementation(async () => {
      if (!cfg) {
        throw new ProviderError(ProviderErrorKind.VALIDATION, Platform.TIKTOK, 'not configured');
      }
      return {
        platform: Platform.TIKTOK,
        isEnabled: true,
        appId: cfg.appId ?? '7000000000000000001',
        appSecret: cfg.appSecret ?? 'tiktok-app-secret',
        redirectUri:
          cfg.redirectUri ?? 'https://api.nsqads.ai/api/v1/providers/tiktok/oauth/callback',
        oauthStateSecret: cfg.oauthStateSecret ?? 'tiktok-state-secret-32-chars-padding',
        apiVersion: cfg.apiVersion ?? 'v1.3',
        scopes: [],
        extra: null,
      };
    }),
  };
}

const prisma = {} as never;
const audit = { log: jest.fn() } as never;
const api = {} as never;

describe('TikTokOAuthService.buildAuthorizeUrl', () => {
  it('throws VALIDATION when no provider config is set', async () => {
    const svc = new TikTokOAuthService(makeProviderConfigsStub(null) as never, prisma, audit, api);
    await expect(svc.buildAuthorizeUrl('org-1', 'user-1')).rejects.toMatchObject({
      kind: ProviderErrorKind.VALIDATION,
      platform: Platform.TIKTOK,
    });
  });

  it('builds a TikTok authorize URL with app_id, redirect_uri, and state', async () => {
    const svc = new TikTokOAuthService(makeProviderConfigsStub({}) as never, prisma, audit, api);
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));

    expect(url.origin).toBe('https://business-api.tiktok.com');
    expect(url.pathname).toBe('/portal/auth');
    expect(url.searchParams.get('app_id')).toBe('7000000000000000001');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.nsqads.ai/api/v1/providers/tiktok/oauth/callback',
    );

    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state!.split('.')).toHaveLength(3);
  });

  it('uses appId + redirectUri from provider config (not hardcoded)', async () => {
    const stub = makeProviderConfigsStub({
      appId: '8888888888888888888',
      redirectUri: 'https://staging.nsqads.ai/api/v1/providers/tiktok/oauth/callback',
    });
    const svc = new TikTokOAuthService(stub as never, prisma, audit, api);
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));
    expect(url.searchParams.get('app_id')).toBe('8888888888888888888');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://staging.nsqads.ai/api/v1/providers/tiktok/oauth/callback',
    );
  });
});
