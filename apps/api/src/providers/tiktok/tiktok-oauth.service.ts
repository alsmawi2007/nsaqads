import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { AdAccountStatus, Platform, Platform as PrismaPlatform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt } from '../../common/utils/crypto.util';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { TikTokApiClient } from './tiktok-api.client';
import { TIKTOK_OAUTH_AUTHORIZE } from './tiktok.constants';

// Owns the OAuth flow:
//   1. /start    → builds the TikTok authorize URL with a signed state JWT.
//   2. /callback → validates state, exchanges auth_code → access+refresh tokens,
//      enumerates advertiser_ids on the token response, persists encrypted
//      AdAccount rows.
//
// All TikTok-specific config (app id, secret, redirect URI, state-signing
// secret) is loaded from ProviderConfigsService at runtime. There is NO env
// fallback — if the System Admin hasn't configured TikTok, /start throws
// VALIDATION before ever building a URL.
//
// TikTok scopes are configured at the app level in TikTok's developer portal
// (not per-request), so the authorize URL only needs app_id, redirect_uri,
// and state. `cfg.scopes` is therefore unused in URL construction — kept on
// the row for parity with other providers and possible future use.

interface StatePayload {
  orgId:  string;
  userId: string;
  nonce:  string;
  iat:    number;
  exp:    number;
}

const STATE_TTL_SECONDS = 600;

@Injectable()
export class TikTokOAuthService {
  private readonly logger = new Logger(TikTokOAuthService.name);

  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    private prisma: PrismaService,
    private audit: AuditService,
    private api: TikTokApiClient,
  ) {}

  async buildAuthorizeUrl(orgId: string, userId: string): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.TIKTOK);
    const state = this.signState(cfg.oauthStateSecret, { orgId, userId });
    const params = new URLSearchParams({
      app_id:       cfg.appId,
      redirect_uri: cfg.redirectUri,
      state,
    });
    return `${TIKTOK_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  async handleCallback(authCode: string, state: string): Promise<{
    orgId: string;
    userId: string;
    accountsConnected: number;
  }> {
    const cfg = await this.providerConfigs.getEnabled(Platform.TIKTOK);
    const payload = this.verifyState(cfg.oauthStateSecret, state);

    // 1. auth_code → access + refresh tokens. TikTok's response includes the
    // advertiser_ids list directly, so no additional walk is needed.
    const tok = await this.api.exchangeCodeForToken(authCode);
    if (!tok.access_token || !tok.refresh_token) {
      throw new ProviderError(
        ProviderErrorKind.UNAUTHORIZED,
        'TIKTOK',
        'TikTok returned an incomplete token response (access_token + refresh_token required)',
      );
    }
    const accessToken = tok.access_token;
    const refreshToken = tok.refresh_token;
    const expiresAt = tok.access_token_expire_in
      ? new Date(Date.now() + tok.access_token_expire_in * 1000)
      : null;

    // 2. The token response includes advertiser_ids. We refetch the named
    // metadata via /oauth2/advertiser/get/ to populate display fields.
    const advertisers = await this.api.listAuthorizedAdvertisers(accessToken);

    // 3. Upsert each as an AdAccount row (encrypted tokens). TikTok does
    // not return currency/timezone on the OAuth response — those fields
    // are filled in by the first /advertiser/info/ read after connect.
    const encryptedAccess = encrypt(accessToken);
    const encryptedRefresh = encrypt(refreshToken);
    let connected = 0;
    for (const adv of advertisers) {
      await this.prisma.adAccount.upsert({
        where: {
          orgId_platform_externalId: {
            orgId:      payload.orgId,
            platform:   PrismaPlatform.TIKTOK,
            externalId: adv.advertiser_id,
          },
        },
        update: {
          name:           adv.advertiser_name ?? undefined,
          accessToken:    encryptedAccess,
          refreshToken:   encryptedRefresh,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
          errorMessage:   null,
          deletedAt:      null,
        },
        create: {
          orgId:          payload.orgId,
          platform:       PrismaPlatform.TIKTOK,
          externalId:     adv.advertiser_id,
          name:           adv.advertiser_name,
          currency:       'USD',     // backfilled from /advertiser/info/ on first sync
          accessToken:    encryptedAccess,
          refreshToken:   encryptedRefresh,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
        },
      });
      connected += 1;
    }

    await this.audit.log({
      orgId:       payload.orgId,
      userId:      payload.userId,
      action:      'tiktok.oauth.connect',
      resourceType:'AdAccount',
      afterState:  { accountsConnected: connected },
    });

    this.logger.log(`TikTok OAuth: org=${payload.orgId} connected=${connected} account(s)`);
    return { orgId: payload.orgId, userId: payload.userId, accountsConnected: connected };
  }

  // ─── State JWT (HMAC-SHA256, header.payload.signature in base64url) ──────
  private signState(secret: string, input: { orgId: string; userId: string }): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: StatePayload = {
      orgId:  input.orgId,
      userId: input.userId,
      nonce:  crypto.randomBytes(16).toString('hex'),
      iat:    now,
      exp:    now + STATE_TTL_SECONDS,
    };
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const body   = b64url(Buffer.from(JSON.stringify(payload)));
    const signing = `${header}.${body}`;
    const sig = b64url(hmac(secret, signing));
    return `${signing}.${sig}`;
  }

  private verifyState(secret: string, token: string): StatePayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new BadRequestException('Invalid state token');
    const [header, body, sig] = parts;
    const expected = b64url(hmac(secret, `${header}.${body}`));
    if (!safeEqual(sig, expected)) throw new BadRequestException('State token signature mismatch');

    let payload: StatePayload;
    try {
      payload = JSON.parse(Buffer.from(b64urlPad(body), 'base64').toString('utf8')) as StatePayload;
    } catch {
      throw new BadRequestException('State token payload malformed');
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new BadRequestException('State token expired');
    return payload;
  }
}

function hmac(secret: string, s: string): Buffer {
  return crypto.createHmac('sha256', secret).update(s).digest();
}

function b64url(buf: Buffer | string): string {
  const s = (typeof buf === 'string' ? Buffer.from(buf) : buf).toString('base64');
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlPad(s: string): string {
  const pad = (4 - (s.length % 4)) % 4;
  return s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
