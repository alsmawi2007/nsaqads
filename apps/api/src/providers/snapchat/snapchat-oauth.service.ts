import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { AdAccountStatus, Platform, Platform as PrismaPlatform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt } from '../../common/utils/crypto.util';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { SnapchatApiClient } from './snapchat-api.client';
import { SNAP_OAUTH_AUTHORIZE, SNAP_OAUTH_SCOPES } from './snapchat.constants';

// Owns the OAuth flow:
//   1. /start    → builds the Snap authorize URL with a signed state JWT.
//   2. /callback → validates state, exchanges code → access+refresh tokens,
//      walks organizations → ad accounts, persists encrypted AdAccount rows.
//
// All Snapchat-specific config (client id/secret, redirect URI, state-signing
// secret, scopes) is loaded from ProviderConfigsService at runtime. There is
// NO env fallback — if the System Admin hasn't configured Snap, /start
// throws VALIDATION before ever building a URL.
//
// ProviderConfig field mapping for Snap:
//   appId         → OAuth client_id
//   appSecret     → OAuth client_secret
//   scopes        → space-separated list (defaults to SNAP_OAUTH_SCOPES if empty)

interface StatePayload {
  orgId:  string;
  userId: string;
  nonce:  string;
  iat:    number;
  exp:    number;
}

const STATE_TTL_SECONDS = 600;

@Injectable()
export class SnapchatOAuthService {
  private readonly logger = new Logger(SnapchatOAuthService.name);

  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    private prisma: PrismaService,
    private audit: AuditService,
    private api: SnapchatApiClient,
  ) {}

  async buildAuthorizeUrl(orgId: string, userId: string): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.SNAPCHAT);
    const scopes = cfg.scopes.length > 0 ? cfg.scopes : SNAP_OAUTH_SCOPES;
    const state = this.signState(cfg.oauthStateSecret, { orgId, userId });
    const params = new URLSearchParams({
      client_id:     cfg.appId,
      redirect_uri:  cfg.redirectUri,
      response_type: 'code',
      scope:         scopes.join(' '),
      state,
    });
    return `${SNAP_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<{
    orgId: string;
    userId: string;
    accountsConnected: number;
  }> {
    const cfg = await this.providerConfigs.getEnabled(Platform.SNAPCHAT);
    const payload = this.verifyState(cfg.oauthStateSecret, state);

    // 1. code → access + refresh tokens
    const tok = await this.api.exchangeCodeForToken(code, cfg.redirectUri);
    if (!tok.access_token || !tok.refresh_token) {
      throw new ProviderError(
        ProviderErrorKind.UNAUTHORIZED,
        'SNAPCHAT',
        'Snapchat returned an incomplete token response (access_token + refresh_token required)',
      );
    }
    const accessToken = tok.access_token;
    const refreshToken = tok.refresh_token;
    const expiresAt = tok.expires_in
      ? new Date(Date.now() + tok.expires_in * 1000)
      : null;

    // 2. Walk organizations → ad accounts to enumerate everything the
    // granted user can manage. Snap has a two-tier hierarchy here.
    const orgs = await this.api.listMyOrganizations(accessToken);
    const allAccounts: { adaccount: { id: string; name?: string; currency?: string; timezone?: string } }[] = [];
    for (const org of orgs) {
      const adAccounts = await this.api.listOrganizationAdAccounts(accessToken, org.id);
      for (const a of adAccounts) {
        allAccounts.push({ adaccount: a });
      }
    }

    // 3. Upsert each as an AdAccount row (encrypted tokens)
    const encryptedAccess = encrypt(accessToken);
    const encryptedRefresh = encrypt(refreshToken);
    let connected = 0;
    for (const { adaccount } of allAccounts) {
      await this.prisma.adAccount.upsert({
        where: {
          orgId_platform_externalId: {
            orgId:      payload.orgId,
            platform:   PrismaPlatform.SNAPCHAT,
            externalId: adaccount.id,
          },
        },
        update: {
          name:           adaccount.name ?? undefined,
          currency:       adaccount.currency ?? undefined,
          timezone:       adaccount.timezone ?? undefined,
          accessToken:    encryptedAccess,
          refreshToken:   encryptedRefresh,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
          errorMessage:   null,
          deletedAt:      null,
        },
        create: {
          orgId:          payload.orgId,
          platform:       PrismaPlatform.SNAPCHAT,
          externalId:     adaccount.id,
          name:           adaccount.name,
          currency:       adaccount.currency ?? 'USD',
          timezone:       adaccount.timezone,
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
      action:      'snapchat.oauth.connect',
      resourceType:'AdAccount',
      afterState:  { accountsConnected: connected },
    });

    this.logger.log(`Snapchat OAuth: org=${payload.orgId} connected=${connected} account(s)`);
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
