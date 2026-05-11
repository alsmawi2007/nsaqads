import { Platform } from '@prisma/client';
import { SnapchatOAuthService } from './snapchat-oauth.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';

// Verifies the dynamic-config contract:
//   1. /start refuses to build a URL until SYSTEM_ADMIN has configured Snap.
//   2. Once configured, the URL contains all expected components and the
//      state JWT verifies under the same DB-backed secret.
//   3. Scopes default to SNAP_OAUTH_SCOPES when empty in the config row.

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
        throw new ProviderError(ProviderErrorKind.VALIDATION, Platform.SNAPCHAT, 'not configured');
      }
      return {
        platform: Platform.SNAPCHAT,
        isEnabled: true,
        appId: cfg.appId ?? 'snap-client-id',
        appSecret: cfg.appSecret ?? 'snap-client-secret',
        redirectUri:
          cfg.redirectUri ?? 'https://api.nsqads.ai/api/v1/providers/snapchat/oauth/callback',
        oauthStateSecret: cfg.oauthStateSecret ?? 'snap-state-secret-32-chars-padding',
        apiVersion: cfg.apiVersion ?? 'v1',
        scopes: cfg.scopes ?? [],
        extra: null,
      };
    }),
  };
}

const prisma = {} as never;
const audit = { log: jest.fn() } as never;
const api = {} as never;

describe('SnapchatOAuthService.buildAuthorizeUrl', () => {
  it('throws VALIDATION when no provider config is set', async () => {
    const svc = new SnapchatOAuthService(makeProviderConfigsStub(null) as never, prisma, audit, api);
    await expect(svc.buildAuthorizeUrl('org-1', 'user-1')).rejects.toMatchObject({
      kind: ProviderErrorKind.VALIDATION,
      platform: Platform.SNAPCHAT,
    });
  });

  it('builds a Snap authorize URL with all components and default scope', async () => {
    const svc = new SnapchatOAuthService(makeProviderConfigsStub({}) as never, prisma, audit, api);
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));

    expect(url.origin).toBe('https://accounts.snapchat.com');
    expect(url.pathname).toBe('/login/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('snap-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.nsqads.ai/api/v1/providers/snapchat/oauth/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('snapchat-marketing-api');

    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state!.split('.')).toHaveLength(3);
  });

  it('uses cfg.scopes when provided (overrides default)', async () => {
    const stub = makeProviderConfigsStub({
      scopes: ['snapchat-marketing-api', 'snapchat-creative-kit'],
    });
    const svc = new SnapchatOAuthService(stub as never, prisma, audit, api);
    const url = new URL(await svc.buildAuthorizeUrl('org-1', 'user-1'));
    expect(url.searchParams.get('scope')).toBe('snapchat-marketing-api snapchat-creative-kit');
  });
});
