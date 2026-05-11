import { Inject, Injectable, Logger } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { httpJson, HttpJsonOptions } from '../shared/http-json';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { withRetry } from '../shared/retry';
import { RATE_LIMITER, RateLimiter } from '../shared/rate-limiter';
import {
  GOOGLE_ADS_BASE,
  GOOGLE_OAUTH_BASE,
  stripDashes,
} from './google-ads.constants';
import {
  GoogleAdsErrorEnvelope,
  GoogleAdsMutateResponse,
  GoogleAdsSearchResponse,
  GoogleAdsSearchRow,
  GoogleListAccessibleCustomersResponse,
  GoogleTokenResponse,
} from './dto/google-ads-raw.types';

// Thin Google-Ads-flavored wrapper over httpJson:
//   - prefixes ads.googleapis.com base + version
//   - injects Authorization, developer-token, and login-customer-id headers
//   - normalizes Google error envelopes to ProviderError
//   - exposes a paginated search helper (GAQL)
//   - calls RateLimiter.acquire() before every outbound HTTP call
//
// All real Google Ads calls go through this client. Nothing else in
// google-ads/ should call fetch directly. Phase 1 RateLimiter is a no-op.
//
// Configuration (apiVersion, developerToken, loginCustomerId, OAuth client_id
// and client_secret) is loaded at runtime from ProviderConfigsService — there
// is NO env fallback. If Google Ads is not configured, getEnabled() throws.

const DEFAULT_API_VERSION = 'v18';

@Injectable()
export class GoogleAdsApiClient {
  private readonly logger = new Logger(GoogleAdsApiClient.name);

  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
  ) {}

  private async base(): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.GOOGLE_ADS);
    const version = cfg.apiVersion ?? DEFAULT_API_VERSION;
    return `${GOOGLE_ADS_BASE}/${version}`;
  }

  private rlKey(externalId?: string | null): string {
    return externalId ? `google-ads:${externalId}` : 'google-ads:app';
  }

  private async adsHeaders(accessToken: string): Promise<Record<string, string>> {
    const cfg = await this.providerConfigs.getEnabled(Platform.GOOGLE_ADS);
    const developerToken = cfg.extraSecrets?.developerToken;
    if (!developerToken) {
      throw new ProviderError(
        ProviderErrorKind.VALIDATION,
        'GOOGLE_ADS',
        'Google Ads developerToken is not configured. Set extraSecrets.developerToken via the System Admin → Providers dashboard.',
      );
    }
    const headers: Record<string, string> = {
      Authorization:     `Bearer ${accessToken}`,
      'developer-token': developerToken,
    };
    // login-customer-id is only required when the authenticated user accesses
    // a customer through an MCC; safe to send when configured.
    const login = (cfg.extra?.loginCustomerId as string | undefined) ?? '';
    if (login) headers['login-customer-id'] = stripDashes(login);
    return headers;
  }

  // ─── GAQL Search (read path) ─────────────────────────────────────────────

  // Streams all results across pageToken pagination. Caller passes the GAQL
  // query string; we handle pagination + retry for rate-limit/network blips.
  async searchAll(
    customerExternalId: string,
    accessToken: string,
    query: string,
    maxPages = 10,
  ): Promise<GoogleAdsSearchRow[]> {
    const out: GoogleAdsSearchRow[] = [];
    const customer = stripDashes(customerExternalId);
    let pageToken: string | undefined;
    let page = 0;

    do {
      const result: GoogleAdsSearchResponse = await withRetry(() =>
        this.rawCall<GoogleAdsSearchResponse>(
          'POST',
          `/customers/${customer}/googleAds:search`,
          accessToken,
          {
            body: {
              query,
              pageSize: 1000,
              ...(pageToken ? { pageToken } : {}),
            },
          },
          customerExternalId,
        ),
      );
      out.push(...(result.results ?? []));
      pageToken = result.nextPageToken;
      page += 1;
    } while (pageToken && page < maxPages);

    return out;
  }

  // ─── Mutations ────────────────────────────────────────────────────────────
  // Google Ads writes go to per-resource :mutate endpoints with an `operations`
  // array. We expose a generic helper; resource-specific shapes live in the
  // provider class.
  async mutate<T extends GoogleAdsMutateResponse>(
    customerExternalId: string,
    accessToken: string,
    resourcePath: string,            // e.g. 'campaignBudgets:mutate'
    operations: Array<Record<string, unknown>>,
  ): Promise<T> {
    const customer = stripDashes(customerExternalId);
    return this.rawCall<T>(
      'POST',
      `/customers/${customer}/${resourcePath}`,
      accessToken,
      { body: { operations } },
      customerExternalId,
    );
  }

  // ─── Account discovery ────────────────────────────────────────────────────
  async listAccessibleCustomers(accessToken: string): Promise<GoogleListAccessibleCustomersResponse> {
    return withRetry(() =>
      this.rawCall<GoogleListAccessibleCustomersResponse>(
        'GET',
        '/customers:listAccessibleCustomers',
        accessToken,
        {},
      ),
    );
  }

  // ─── OAuth token endpoint ────────────────────────────────────────────────
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.GOOGLE_ADS);
    const body = new URLSearchParams({
      code,
      client_id:     cfg.appId,
      client_secret: cfg.appSecret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    });
    return this.tokenCall(body);
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.GOOGLE_ADS);
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     cfg.appId,
      client_secret: cfg.appSecret,
      grant_type:    'refresh_token',
    });
    return this.tokenCall(body);
  }

  private async tokenCall(body: URLSearchParams): Promise<GoogleTokenResponse> {
    await this.rateLimiter.acquire(this.rlKey());
    const res = await httpJson(
      `${GOOGLE_OAUTH_BASE}/token`,
      'GOOGLE_ADS',
      { method: 'POST', body },
    );
    if (!res.ok) {
      throw this.mapOauthError(res.status, res.body, res.headers);
    }
    return res.body as GoogleTokenResponse;
  }

  // ─── Internals ───────────────────────────────────────────────────────────
  private async rawCall<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    accessToken: string,
    opts: { query?: HttpJsonOptions['query']; body?: HttpJsonOptions['body'] },
    rateLimitExternalId?: string,
  ): Promise<T> {
    await this.rateLimiter.acquire(this.rlKey(rateLimitExternalId));
    const url = `${await this.base()}${path}`;
    const res = await httpJson(url, 'GOOGLE_ADS', {
      method,
      headers: await this.adsHeaders(accessToken),
      ...opts,
    });
    if (!res.ok) throw this.mapError(res.status, res.body, res.headers);
    return res.body as T;
  }

  // Google Ads errors arrive as either an array `[ { error: { ... } } ]`
  // (legacy) or an object `{ error: { ... } }`. Both shapes get normalized.
  private mapError(status: number, body: unknown, headers: Headers): ProviderError {
    const envelope = this.unwrapEnvelope(body);
    const err = envelope?.error;
    const message = err?.message ?? `Google Ads API error (status ${status})`;
    const grpcStatus = err?.status ?? null;
    const detailErrors = err?.details?.[0]?.errors ?? [];
    const firstErrorCode = detailErrors[0]?.errorCode
      ? Object.keys(detailErrors[0].errorCode!)[0] +
        ':' +
        Object.values(detailErrors[0].errorCode!)[0]
      : null;
    const providerCode = firstErrorCode ?? grpcStatus ?? String(status);

    let kind: ProviderErrorKind;
    if (status === 401 || grpcStatus === 'UNAUTHENTICATED') {
      // Google bundles "token expired" and "invalid token" under
      // UNAUTHENTICATED. The token service distinguishes by attempting refresh.
      kind = ProviderErrorKind.INVALID_TOKEN;
    } else if (status === 403 || grpcStatus === 'PERMISSION_DENIED') {
      kind = ProviderErrorKind.UNAUTHORIZED;
    } else if (status === 404 || grpcStatus === 'NOT_FOUND') {
      kind = ProviderErrorKind.NOT_FOUND;
    } else if (status === 429 || grpcStatus === 'RESOURCE_EXHAUSTED') {
      kind = ProviderErrorKind.RATE_LIMIT;
    } else if (status >= 500 || grpcStatus === 'INTERNAL' || grpcStatus === 'UNAVAILABLE') {
      kind = ProviderErrorKind.PROVIDER_ERROR;
    } else if (status === 400 || grpcStatus === 'INVALID_ARGUMENT') {
      kind = ProviderErrorKind.VALIDATION;
    } else {
      kind = ProviderErrorKind.UNKNOWN;
    }

    const retryAfterHeader = headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

    return new ProviderError(kind, 'GOOGLE_ADS', message, {
      providerCode,
      retryAfterSeconds: Number.isNaN(retryAfterSeconds as number) ? null : retryAfterSeconds,
      raw: body,
    });
  }

  // OAuth token endpoint errors are shaped differently:
  //   { error: 'invalid_grant', error_description: '...' }
  private mapOauthError(status: number, body: unknown, headers: Headers): ProviderError {
    const b = (body ?? {}) as { error?: string; error_description?: string };
    const message = b.error_description ?? b.error ?? `Google OAuth error (status ${status})`;
    const code = b.error ?? String(status);

    let kind: ProviderErrorKind;
    if (b.error === 'invalid_grant' || b.error === 'invalid_token') {
      kind = ProviderErrorKind.INVALID_TOKEN;
    } else if (b.error === 'unauthorized_client' || status === 401 || status === 403) {
      kind = ProviderErrorKind.UNAUTHORIZED;
    } else if (status === 429) {
      kind = ProviderErrorKind.RATE_LIMIT;
    } else if (status >= 500) {
      kind = ProviderErrorKind.PROVIDER_ERROR;
    } else {
      kind = ProviderErrorKind.VALIDATION;
    }

    const retryAfterHeader = headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

    return new ProviderError(kind, 'GOOGLE_ADS', message, {
      providerCode: code,
      retryAfterSeconds: Number.isNaN(retryAfterSeconds as number) ? null : retryAfterSeconds,
      raw: body,
    });
  }

  private unwrapEnvelope(body: unknown): GoogleAdsErrorEnvelope | null {
    if (!body) return null;
    if (Array.isArray(body) && body.length > 0) {
      return body[0] as GoogleAdsErrorEnvelope;
    }
    return body as GoogleAdsErrorEnvelope;
  }
}
