import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { AdAccountStatus, Platform, Platform as PrismaPlatform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt } from '../../common/utils/crypto.util';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { GoogleAdsApiClient } from './google-ads-api.client';
import { GOOGLE_ADS_OAUTH_SCOPES, GOOGLE_AUTHORIZE_URL, stripDashes } from './google-ads.constants';

// Owns the Google Ads OAuth flow:
//   1. /start    → builds the Google authorize URL with a signed state JWT
//                  (offline access + prompt=consent so we ALWAYS get a refresh_token)
//   2. /callback → validates state, exchanges code for access+refresh tokens,
//                  lists accessible customers, persists encrypted AdAccount rows.
//
// All Google Ads-specific config (client id/secret, redirect URI, state-signing
// secret, scopes, developer-token, login-customer-id) is loaded from
// ProviderConfigsService at runtime. There is NO env fallback — if the System
// Admin hasn't configured Google Ads, /start throws VALIDATION before ever
// building a URL.
//
// ProviderConfig field mapping for Google Ads:
//   appId                       → OAuth client_id
//   appSecret                   → OAuth client_secret
//   extraSecrets.developerToken → developer-token header on every API call
//   extra.loginCustomerId       → login-customer-id header (optional MCC scope)
//   scopes                      → defaults to GOOGLE_ADS_OAUTH_SCOPES if empty

interface StatePayload {
  orgId: string;
  userId: string;
  nonce: string;
  iat: number;
  exp: number;
}

const STATE_TTL_SECONDS = 600;

@Injectable()
export class GoogleAdsOAuthService {
  private readonly logger = new Logger(GoogleAdsOAuthService.name);

  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    private prisma: PrismaService,
    private audit: AuditService,
    private api: GoogleAdsApiClient,
  ) {}

  async buildAuthorizeUrl(orgId: string, userId: string): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.GOOGLE_ADS);
    this.assertDeveloperToken(cfg.extraSecrets);
    const scopes = cfg.scopes.length > 0 ? cfg.scopes : GOOGLE_ADS_OAUTH_SCOPES;
    const state = this.signState(cfg.oauthStateSecret, { orgId, userId });
    const params = new URLSearchParams({
      client_id:     cfg.appId,
      redirect_uri:  cfg.redirectUri,
      response_type: 'code',
      scope:         scopes.join(' '),
      access_type:   'offline',          // → refresh_token
      prompt:        'consent',          // force refresh_token even on re-consent
      include_granted_scopes: 'true',
      state,
    });
    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<{
    orgId: string;
    userId: string;
    accountsConnected: number;
  }> {
    const cfg = await this.providerConfigs.getEnabled(Platform.GOOGLE_ADS);
    this.assertDeveloperToken(cfg.extraSecrets);
    const payload = this.verifyState(cfg.oauthStateSecret, state);

    // 1. code → access_token + refresh_token
    const tokens = await this.api.exchangeCodeForToken(code, cfg.redirectUri);
    if (!tokens.access_token) {
      throw new ProviderError(
        ProviderErrorKind.UNAUTHORIZED,
        'GOOGLE_ADS',
        'Google returned no access token from code exchange',
      );
    }
    if (!tokens.refresh_token) {
      throw new ProviderError(
        ProviderErrorKind.UNAUTHORIZED,
        'GOOGLE_ADS',
        'Google did not return a refresh_token; ensure prompt=consent and access_type=offline are set, and that the user has not previously authorized without offline access.',
      );
    }
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    // 2. Enumerate accessible customers
    const accessible = await this.api.listAccessibleCustomers(accessToken);
    const resourceNames = accessible.resourceNames ?? [];

    // 3. Upsert each customer as an AdAccount row (encrypted tokens)
    const encryptedAccess  = encrypt(accessToken);
    const encryptedRefresh = encrypt(refreshToken);
    let connected = 0;

    for (const rn of resourceNames) {
      // resourceName is 'customers/1234567890'
      const customerId = rn.split('/')[1];
      if (!customerId) continue;
      const externalId = stripDashes(customerId);

      await this.prisma.adAccount.upsert({
        where: {
          orgId_platform_externalId: {
            orgId:      payload.orgId,
            platform:   PrismaPlatform.GOOGLE_ADS,
            externalId,
          },
        },
        update: {
          accessToken:    encryptedAccess,
          refreshToken:   encryptedRefresh,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
          errorMessage:   null,
          deletedAt:      null,
        },
        create: {
          orgId:          payload.orgId,
          platform:       PrismaPlatform.GOOGLE_ADS,
          externalId,
          // Name + currency are filled in on the first sync — the
          // listAccessibleCustomers response does not carry them.
          name:           `Google Ads ${customerId}`,
          currency:       'USD',
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
      action:      'google-ads.oauth.connect',
      resourceType:'AdAccount',
      afterState:  { accountsConnected: connected },
    });

    this.logger.log(`Google Ads OAuth: org=${payload.orgId} connected=${connected} customer(s)`);
    return { orgId: payload.orgId, userId: payload.userId, accountsConnected: connected };
  }

  // developerToken is required for every API call; refusing /start without
  // it gives admins a clearer error than a 403 mid-OAuth-callback.
  private assertDeveloperToken(extraSecrets: Record<string, string> | null): void {
    const dev = extraSecrets?.developerToken;
    if (!dev) {
      throw new ProviderError(
        ProviderErrorKind.VALIDATION,
        'GOOGLE_ADS',
        'Google Ads developerToken is not configured. Set extraSecrets.developerToken via the System Admin → Providers dashboard.',
      );
    }
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
