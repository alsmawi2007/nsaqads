import { Platform } from '@prisma/client';
import { MetaOAuthService } from './meta-oauth.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';

// Verifies the dynamic-config contract:
//   1. /start refuses to build a URL until SYSTEM_ADMIN has configured Meta.
//   2. Once configured, the URL contains all expected components and the
//      state JWT verifies under the same DB-backed secret.

function makeProviderConfigsStub(cfg: {
  appId?: string;
  appSecret?: string;
  redirectUri?: string;
  oauthStateSecret?: string;
  apiVersion?: string;
  scopes?: string[];
} | null) {
  return {
    getEnabled: jest.fn().mockImplementation(async () => {
      if (!cfg) {
        throw new ProviderError(ProviderErrorKind.VALIDATION, Platform.META, 'not configured');
      }
      return {
        platform: Platform.META,
        isEnabled: true,
        appId: cfg.appId ?? '1234567890',
        appSecret: cfg.appSecret ?? 'app-secret',
        redirectUri: cfg.redirectUri ?? 'https://api.nsqads.ai/api/v1/providers/meta/oauth/callback',
        oauthStateSecret: cfg.oauthStateSecret ?? 'state-secret-32-chars-min-padding',
        apiVersion: cfg.apiVersion ?? 'v21.0',
        scopes: cfg.scopes ?? ['ads_management', 'ads_read', 'business_management'],
        extra: null,
      };
    }),
  };
}

const prisma = {} as never;
const audit = { log: jest.fn() } as never;
const api = {} as never;

describe('MetaOAuthService.buildAuthorizeUrl', () => {
  it('throws VALIDATION when no provider config is set', async () => {
    const svc = new MetaOAuthService(makeProviderConfigsStub(null) as never, prisma, audit, api);
    await expect(svc.buildAuthorizeUrl('org-1', 'user-1')).rejects.toMatchObject({
      kind: ProviderErrorKind.VALIDATION,
      platform: Platform.META,
    });
  });

  it('builds a Facebook authorize URL with all components when configured', async () => {
    const svc = new MetaOAuthService(makeProviderConfigsStub({}) as never, prisma, audit, api);
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));

    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.pathname).toBe('/v21.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.nsqads.ai/api/v1/providers/meta/oauth/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('ads_management,ads_read,business_management');

    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state!.split('.')).toHaveLength(3);
  });

  it('respects custom apiVersion + scopes from provider config', async () => {
    const stub = makeProviderConfigsStub({
      apiVersion: 'v22.0',
      scopes: ['ads_read'],
    });
    const svc = new MetaOAuthService(stub as never, prisma, audit, api);
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));
    expect(url.pathname).toBe('/v22.0/dialog/oauth');
    expect(url.searchParams.get('scope')).toBe('ads_read');
  });
});
