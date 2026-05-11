import { Inject, Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { httpJson, HttpJsonOptions } from '../shared/http-json';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { withRetry } from '../shared/retry';
import { RATE_LIMITER, RateLimiter } from '../shared/rate-limiter';
import {
  TIKTOK_API_BASE,
  TIKTOK_OAUTH_TOKEN,
  TIKTOK_OAUTH_ADVERTISERS,
} from './tiktok.constants';
import {
  TikTokEnvelope,
  TikTokTokenResponse,
  TikTokAdvertiser,
  TikTokAdvertiserListResponse,
  TikTokCampaign,
  TikTokAdGroup,
  TikTokReportRow,
  TikTokStatsRow,
} from './dto/tiktok-raw.types';

// Thin TikTok-flavored wrapper over httpJson:
//   - prefixes /open_api/{apiVersion}/ base path (apiVersion from ProviderConfigsService)
//   - injects Access-Token header (NOT Bearer Authorization)
//   - unwraps the {code, message, data} envelope on every response and throws
//     ProviderError when code !== 0 (even on HTTP 200)
//   - exposes typed list helpers
//   - calls RateLimiter.acquire() before every outbound HTTP call
//
// All real TikTok calls go through this client. Nothing else in tiktok/
// should call fetch directly. apiVersion + appId + appSecret are loaded per-call
// from ProviderConfigsService (cached in-memory for 60s).

@Injectable()
export class TikTokApiClient {
  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
  ) {}

  private async base(): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.TIKTOK);
    return `${TIKTOK_API_BASE}/${cfg.apiVersion ?? 'v1.3'}`;
  }

  private rlKey(externalId?: string | null): string {
    return externalId ? `tiktok:${externalId}` : 'tiktok:app';
  }

  // ─── Generic GET (read paths — wrapped in withRetry) ─────────────────────
  async get<T>(
    path: string,
    accessToken: string,
    query: HttpJsonOptions['query'] = {},
    rateLimitExternalId?: string,
  ): Promise<T> {
    return withRetry(() =>
      this.rawCall<T>('GET', path, accessToken, { query }, rateLimitExternalId),
    );
  }

  // ─── Generic POST (mutations — NO retry, caller decides) ─────────────────
  async post<T>(
    path: string,
    accessToken: string,
    body: Record<string, unknown>,
    rateLimitExternalId?: string,
  ): Promise<T> {
    return this.rawCall<T>('POST', path, accessToken, { body }, rateLimitExternalId);
  }

  // ─── OAuth helpers ────────────────────────────────────────────────────────
  // TikTok's OAuth endpoints expect a JSON body with app_id, secret, auth_code
  // (or refresh_token). Unlike the canonical OAuth 2.0 form-encoded flow, TikTok
  // uses application/json. The response is wrapped in the same envelope.
  async exchangeCodeForToken(authCode: string): Promise<TikTokTokenResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.TIKTOK);
    return this.oauthCall<TikTokTokenResponse>(TIKTOK_OAUTH_TOKEN, {
      app_id:    cfg.appId,
      secret:    cfg.appSecret,
      auth_code: authCode,
    });
  }

  async refreshToken(refreshToken: string): Promise<TikTokTokenResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.TIKTOK);
    return this.oauthCall<TikTokTokenResponse>(TIKTOK_OAUTH_TOKEN, {
      app_id:        cfg.appId,
      secret:        cfg.appSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    });
  }

  async listAuthorizedAdvertisers(
    accessToken: string,
  ): Promise<{ advertiser_id: string; advertiser_name?: string }[]> {
    // /oauth2/advertiser/get/ is unusual: it requires both access_token and
    // app credentials in the query string. The api-client surfaces the list
    // already unwrapped from the envelope.
    const cfg = await this.providerConfigs.getEnabled(Platform.TIKTOK);
    await this.rateLimiter.acquire(this.rlKey());
    const url =
      `${TIKTOK_OAUTH_ADVERTISERS}?` +
      new URLSearchParams({
        access_token: accessToken,
        app_id:       cfg.appId,
        secret:       cfg.appSecret,
      }).toString();

    const res = await httpJson(url, 'TIKTOK', { method: 'GET' });
    if (!res.ok) throw this.mapHttpError(res.status, res.body, res.headers);
    const env = res.body as TikTokEnvelope<TikTokAdvertiserListResponse>;
    if (env.code !== 0) throw this.mapEnvelopeError(env);
    return env.data?.list ?? [];
  }

  // ─── Convenience read helpers ─────────────────────────────────────────────

  async getAdvertiser(
    accessToken: string,
    advertiserId: string,
  ): Promise<TikTokAdvertiser | null> {
    const data = await this.get<{ list?: TikTokAdvertiser[] }>(
      '/advertiser/info/',
      accessToken,
      { advertiser_ids: JSON.stringify([advertiserId]) },
      advertiserId,
    );
    return data.list?.[0] ?? null;
  }

  async listCampaigns(
    accessToken: string,
    advertiserId: string,
  ): Promise<TikTokCampaign[]> {
    const data = await this.get<{ list?: TikTokCampaign[] }>(
      '/campaign/get/',
      accessToken,
      { advertiser_id: advertiserId, page_size: 1000 },
      advertiserId,
    );
    return data.list ?? [];
  }

  async listAdGroups(
    accessToken: string,
    advertiserId: string,
    campaignId: string,
  ): Promise<TikTokAdGroup[]> {
    const data = await this.get<{ list?: TikTokAdGroup[] }>(
      '/adgroup/get/',
      accessToken,
      {
        advertiser_id: advertiserId,
        filtering:     JSON.stringify({ campaign_ids: [campaignId] }),
        page_size:     1000,
      },
      advertiserId,
    );
    return data.list ?? [];
  }

  // Reports endpoint. We always request granularity=BASIC for the rolled-up
  // window total. Returns a flat row keyed by metric name with values as
  // strings — caller must coerce.
  async fetchReport(
    accessToken: string,
    advertiserId: string,
    entityType: 'CAMPAIGN' | 'AD_GROUP',
    externalId: string,
    startDate: string,
    endDate: string,
    metricFields: string[],
  ): Promise<TikTokStatsRow | null> {
    const data = await this.get<{ list?: TikTokReportRow[] }>(
      '/report/integrated/get/',
      accessToken,
      {
        advertiser_id:     advertiserId,
        report_type:       'BASIC',
        data_level:        entityType === 'CAMPAIGN' ? 'AUCTION_CAMPAIGN' : 'AUCTION_ADGROUP',
        dimensions:        JSON.stringify([entityType === 'CAMPAIGN' ? 'campaign_id' : 'adgroup_id']),
        metrics:           JSON.stringify(metricFields),
        start_date:        startDate,
        end_date:          endDate,
        filtering:         JSON.stringify([{
          field_name:   entityType === 'CAMPAIGN' ? 'campaign_ids' : 'adgroup_ids',
          filter_type:  'IN',
          filter_value: JSON.stringify([externalId]),
        }]),
        page_size:         1,
      },
      advertiserId,
    );
    const row = data.list?.[0];
    if (!row?.metrics) return null;
    return row.metrics as unknown as TikTokStatsRow;
  }

  // ─── Mutations ────────────────────────────────────────────────────────────
  // TikTok mutations are POST endpoints with /campaign/update/, /adgroup/update/.
  // No parent-resolution is needed — every mutation includes advertiser_id +
  // entity id directly in the body.

  async updateCampaign(
    accessToken: string,
    advertiserId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.post<unknown>(
      '/campaign/update/',
      accessToken,
      { advertiser_id: advertiserId, ...body },
      advertiserId,
    );
  }

  async updateAdGroup(
    accessToken: string,
    advertiserId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.post<unknown>(
      '/adgroup/update/',
      accessToken,
      { advertiser_id: advertiserId, ...body },
      advertiserId,
    );
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  private async rawCall<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    accessToken: string | null,
    opts: { query?: HttpJsonOptions['query']; body?: HttpJsonOptions['body'] },
    rateLimitExternalId?: string,
  ): Promise<T> {
    await this.rateLimiter.acquire(this.rlKey(rateLimitExternalId));

    const url = `${await this.base()}${path}`;
    const headers: Record<string, string> = {};
    // TikTok uses an `Access-Token` header — NOT the OAuth 2.0 Bearer scheme.
    if (accessToken) headers['Access-Token'] = accessToken;

    const res = await httpJson(url, 'TIKTOK', { method, headers, ...opts });
    if (!res.ok) throw this.mapHttpError(res.status, res.body, res.headers);

    const env = res.body as TikTokEnvelope<T>;
    if (typeof env?.code !== 'number') {
      throw new ProviderError(
        ProviderErrorKind.PROVIDER_ERROR,
        'TIKTOK',
        `TikTok response missing envelope code field`,
        { raw: res.body },
      );
    }
    if (env.code !== 0) throw this.mapEnvelopeError(env);
    return (env.data as T) ?? ({} as T);
  }

  // OAuth endpoints follow the same envelope shape as the rest of the API.
  // We do NOT pass an Access-Token header — the body carries app credentials
  // (and refresh_token / auth_code) directly.
  private async oauthCall<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    await this.rateLimiter.acquire(this.rlKey());

    const res = await httpJson(url, 'TIKTOK', { method: 'POST', body });
    if (!res.ok) throw this.mapHttpError(res.status, res.body, res.headers);

    const env = res.body as TikTokEnvelope<T>;
    if (typeof env?.code !== 'number') {
      throw new ProviderError(
        ProviderErrorKind.PROVIDER_ERROR,
        'TIKTOK',
        `TikTok OAuth response missing envelope code field`,
        { raw: res.body },
      );
    }
    if (env.code !== 0) throw this.mapEnvelopeError(env);
    return (env.data as T) ?? ({} as T);
  }

  // Transport-level (HTTP) errors. Most TikTok errors arrive with HTTP 200
  // and code !== 0; this path handles the rare 5xx / 429.
  private mapHttpError(
    status: number,
    body: unknown,
    headers: Headers,
  ): ProviderError {
    let kind: ProviderErrorKind;
    if (status === 401) kind = ProviderErrorKind.INVALID_TOKEN;
    else if (status === 403) kind = ProviderErrorKind.UNAUTHORIZED;
    else if (status === 404) kind = ProviderErrorKind.NOT_FOUND;
    else if (status === 429) kind = ProviderErrorKind.RATE_LIMIT;
    else if (status >= 500) kind = ProviderErrorKind.PROVIDER_ERROR;
    else if (status === 400 || status === 422) kind = ProviderErrorKind.VALIDATION;
    else kind = ProviderErrorKind.UNKNOWN;

    const retryAfter = headers.get('retry-after');
    const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;

    return new ProviderError(kind, 'TIKTOK', `TikTok HTTP error (status ${status})`, {
      providerCode: String(status),
      retryAfterSeconds: Number.isNaN(retryAfterSeconds as number) ? null : retryAfterSeconds,
      raw: body,
    });
  }

  // Envelope-level errors. TikTok numeric codes:
  //   40000–40099 — generic input / validation errors
  //   40100/40101 — auth / token-invalid family
  //   40105       — account permission denied
  //   50000+      — server-side
  //   50002       — rate limit (also 51001)
  // The mapping below errs on the side of validation for unknown 4xx codes.
  private mapEnvelopeError(env: TikTokEnvelope<unknown>): ProviderError {
    const code = env.code;
    let kind: ProviderErrorKind;
    if (code === 40100 || code === 40101 || code === 40102) kind = ProviderErrorKind.INVALID_TOKEN;
    else if (code === 40103 || code === 40104 || code === 40105) kind = ProviderErrorKind.UNAUTHORIZED;
    else if (code === 40002) kind = ProviderErrorKind.NOT_FOUND;
    else if (code === 50002 || code === 51001) kind = ProviderErrorKind.RATE_LIMIT;
    else if (code >= 50000) kind = ProviderErrorKind.PROVIDER_ERROR;
    else if (code >= 40000) kind = ProviderErrorKind.VALIDATION;
    else kind = ProviderErrorKind.UNKNOWN;

    return new ProviderError(
      kind,
      'TIKTOK',
      env.message || `TikTok API error (code ${code})`,
      { providerCode: String(code), raw: env },
    );
  }
}
