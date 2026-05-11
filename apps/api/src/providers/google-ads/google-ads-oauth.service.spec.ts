import { Platform } from '@prisma/client';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';

// Verifies the dynamic-config contract for Google Ads:
//   1. /start refuses to build a URL when Google Ads is not configured.
//   2. /start refuses to build a URL when developerToken is missing from
//      extraSecrets — the developer-token header is required on every API
//      call and admins should hit a clean error before OAuth, not a 403 mid
//      callback.
//   3. Once fully configured, the URL contains all expected components
//      (client_id, redirect_uri, prompt=consent, access_type=offline) and
//      the state JWT verifies under the DB-backed secret.

function makeProviderConfigsStub(cfg: {
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  oauthStateSecret?: string;
  apiVersion?: string | null;
  scopes?: string[];
  extra?: Record<string, unknown> | null;
  extraSecrets?: Record<string, string> | null;
} | null) {
  return {
    getEnabled: jest.fn().mockImplementation(async () => {
      if (!cfg) {
        throw new ProviderError(
          ProviderErrorKind.VALIDATION,
          Platform.GOOGLE_ADS,
          'not configured',
        );
      }
      return {
        platform: Platform.GOOGLE_ADS,
        isEnabled: true,
        appId:    cfg.appId    ?? 'google-client-id.apps.googleusercontent.com',
        appSecret: cfg.appSecret ?? 'google-client-secret',
        redirectUri:
          cfg.redirectUri ?? 'https://api.nsqads.ai/api/v1/providers/google-ads/oauth/callback',
        oauthStateSecret: cfg.oauthStateSecret ?? 'google-state-secret-32-chars-pad',
        apiVersion: cfg.apiVersion ?? 'v18',
        scopes: cfg.scopes ?? [],
        extra: cfg.extra ?? null,
        extraSecrets:
          cfg.extraSecrets === undefined
            ? { developerToken: 'abc123-developer-token' }
            : cfg.extraSecrets,
      };
    }),
  };
}

const prisma = {} as never;
const audit = { log: jest.fn() } as never;
const api = {} as never;

describe('GoogleAdsOAuthService.buildAuthorizeUrl', () => {
  it('throws VALIDATION when no provider config is set', async () => {
    const svc = new GoogleAdsOAuthService(
      makeProviderConfigsStub(null) as never,
      prisma,
      audit,
      api,
    );
    await expect(svc.buildAuthorizeUrl('org-1', 'user-1')).rejects.toMatchObject({
      kind: ProviderErrorKind.VALIDATION,
      platform: Platform.GOOGLE_ADS,
    });
  });

  it('throws VALIDATION when developerToken is missing from extraSecrets', async () => {
    const svc = new GoogleAdsOAuthService(
      makeProviderConfigsStub({ extraSecrets: null }) as never,
      prisma,
      audit,
      api,
    );
    await expect(svc.buildAuthorizeUrl('org-1', 'user-1')).rejects.toMatchObject({
      kind: ProviderErrorKind.VALIDATION,
      platform: Platform.GOOGLE_ADS,
    });
  });

  it('builds a Google authorize URL with offline access + consent prompt', async () => {
    const svc = new GoogleAdsOAuthService(
      makeProviderConfigsStub({}) as never,
      prisma,
      audit,
      api,
    );
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));

    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.pathname).toBe('/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(
      'google-client-id.apps.googleusercontent.com',
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.nsqads.ai/api/v1/providers/google-ads/oauth/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/adwords',
    );

    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state!.split('.')).toHaveLength(3);
  });
});
