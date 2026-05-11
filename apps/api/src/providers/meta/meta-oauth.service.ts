import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { AdAccountStatus, Platform, Platform as PrismaPlatform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt } from '../../common/utils/crypto.util';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { MetaApiClient } from './meta-api.client';

// Owns the OAuth flow:
//   1. /start  → builds the Facebook authorize URL with a signed state JWT
//   2. /callback → validates state, exchanges code → short token → long token,
//      lists /me/adaccounts, persists encrypted AdAccount rows.
//
// All Meta-specific config (app id, secret, redirect URI, state-signing secret,
// API version, scopes) is loaded from ProviderConfigsService at runtime. There
// is NO env fallback — if the System Admin hasn't configured Meta, /start
// throws VALIDATION before ever building a URL.
//
// State JWT note: the signing secret comes from the DB row at the moment the
// flow starts. If the admin rotates `oauthStateSecret` between /start and
// /callback, callback verification fails. The 10-minute state TTL gives a
// clean rotation window — admins should avoid rotating during a live flow.

interface StatePayload {
  orgId: string;
  userId: string;
  nonce: string;
  iat: number;             // epoch seconds
  exp: number;
}

const STATE_TTL_SECONDS = 600;   // 10 minutes

@Injectable()
export class MetaOAuthService {
  private readonly logger = new Logger(MetaOAuthService.name);

  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    private prisma: PrismaService,
    private audit: AuditService,
    private api: MetaApiClient,
  ) {}

  async buildAuthorizeUrl(orgId: string, userId: string): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.META);
    const apiVersion = cfg.apiVersion ?? 'v21.0';
    const state = this.signState(cfg.oauthStateSecret, { orgId, userId });
    const params = new URLSearchParams({
      client_id:     cfg.appId,
      redirect_uri:  cfg.redirectUri,
      state,
      scope:         cfg.scopes.join(','),
      response_type: 'code',
    });
    return `https://www.facebook.com/${apiVersion}/dialog/oauth?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<{
    orgId: string;
    userId: string;
    accountsConnected: number;
  }> {
    const cfg = await this.providerConfigs.getEnabled(Platform.META);
    const payload = this.verifyState(cfg.oauthStateSecret, state);

    // 1. code → short-lived token
    const shortLived = await this.api.exchangeCodeForToken(code, cfg.redirectUri);
    if (!shortLived.access_token) {
      throw new ProviderError(
        ProviderErrorKind.UNAUTHORIZED,
        'META',
        'Meta returned no access token from code exchange',
      );
    }

    // 2. short-lived → long-lived (~60 days)
    const longLived = await this.api.exchangeForLongLivedToken(shortLived.access_token);
    if (!longLived.access_token) {
      throw new ProviderError(
        ProviderErrorKind.UNAUTHORIZED,
        'META',
        'Meta returned no access token from long-lived exchange',
      );
    }
    const accessToken = longLived.access_token;
    const expiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000)
      : null;

    // 3. Enumerate ad accounts the granted user can manage
    const metaAccounts = await this.api.listMyAdAccounts(accessToken);

    // 4. Upsert each as an AdAccount row (encrypted token)
    const encrypted = encrypt(accessToken);
    let connected = 0;
    for (const m of metaAccounts) {
      await this.prisma.adAccount.upsert({
        where: {
          orgId_platform_externalId: {
            orgId: payload.orgId,
            platform: PrismaPlatform.META,
            externalId: m.id,
          },
        },
        update: {
          name:           m.name ?? undefined,
          currency:       m.currency ?? undefined,
          timezone:       m.timezone_name ?? undefined,
          accessToken:    encrypted,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
          errorMessage:   null,
          deletedAt:      null,
        },
        create: {
          orgId:          payload.orgId,
          platform:       PrismaPlatform.META,
          externalId:     m.id,
          name:           m.name,
          currency:       m.currency ?? 'USD',
          timezone:       m.timezone_name,
          accessToken:    encrypted,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
        },
      });
      connected += 1;
    }

    await this.audit.log({
      orgId:       payload.orgId,
      userId:      payload.userId,
      action:      'meta.oauth.connect',
      resourceType:'AdAccount',
      afterState:  { accountsConnected: connected },
    });

    this.logger.log(`Meta OAuth: org=${payload.orgId} connected=${connected} account(s)`);
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
