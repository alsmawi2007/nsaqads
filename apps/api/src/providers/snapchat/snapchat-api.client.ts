import { Inject, Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { httpJson, HttpJsonOptions } from '../shared/http-json';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { withRetry } from '../shared/retry';
import { RATE_LIMITER, RateLimiter } from '../shared/rate-limiter';
import { SNAP_API_BASE, SNAP_OAUTH_TOKEN } from './snapchat.constants';
import {
  SnapErrorBody,
  SnapTokenResponse,
  SnapAdAccount,
  SnapOrganization,
  SnapCampaign,
  SnapAdSquad,
  SnapStats,
} from './dto/snapchat-raw.types';

// Thin Snapchat-flavored wrapper over httpJson:
//   - prefixes /v1/ base path
//   - injects Bearer token header
//   - normalizes Snap envelope errors → ProviderError
//   - exposes typed list helpers that strip the sub-request envelopes
//   - calls RateLimiter.acquire() before every outbound HTTP call
//
// All real Snapchat calls go through this client. Nothing else in snapchat/
// should call fetch directly. Phase 1 RateLimiter is a no-op; the seam is
// wired so swapping in a Redis-backed limiter later is a one-line change.

@Injectable()
export class SnapchatApiClient {
  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
  ) {}

  private async base(): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.SNAPCHAT);
    return `${SNAP_API_BASE}/${cfg.apiVersion ?? 'v1'}`;
  }

  private rlKey(externalId?: string | null): string {
    return externalId ? `snap:${externalId}` : 'snap:app';
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

  // ─── Form-encoded POST (used for OAuth token exchange + refresh) ─────────
  async postForm<T>(url: string, body: URLSearchParams): Promise<T> {
    await this.rateLimiter.acquire(this.rlKey());

    const res = await httpJson(url, 'SNAPCHAT', { method: 'POST', body });
    if (!res.ok) throw this.mapOAuthError(res.status, res.body, res.headers);
    return res.body as T;
  }

  // ─── OAuth helpers ────────────────────────────────────────────────────────
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<SnapTokenResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.SNAPCHAT);
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     cfg.appId,
      client_secret: cfg.appSecret,
    });
    return this.postForm<SnapTokenResponse>(SNAP_OAUTH_TOKEN, body);
  }

  async refreshToken(refreshToken: string): Promise<SnapTokenResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.SNAPCHAT);
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     cfg.appId,
      client_secret: cfg.appSecret,
    });
    return this.postForm<SnapTokenResponse>(SNAP_OAUTH_TOKEN, body);
  }

  // ─── Convenience read helpers ─────────────────────────────────────────────

  // Snap requires walking organizations → ad accounts. The OAuth flow uses
  // this to enumerate every ad account the granted user can manage.
  async listMyOrganizations(accessToken: string): Promise<SnapOrganization[]> {
    const res = await this.get<{ organizations?: { organization: SnapOrganization }[] }>(
      '/me/organizations',
      accessToken,
    );
    return (res.organizations ?? []).map((e) => e.organization);
  }

  async listOrganizationAdAccounts(
    accessToken: string,
    organizationId: string,
  ): Promise<SnapAdAccount[]> {
    const res = await this.get<{ adaccounts?: { adaccount: SnapAdAccount }[] }>(
      `/organizations/${organizationId}/adaccounts`,
      accessToken,
    );
    return (res.adaccounts ?? []).map((e) => e.adaccount);
  }

  async listCampaigns(
    accessToken: string,
    adAccountExternalId: string,
  ): Promise<SnapCampaign[]> {
    const res = await this.get<{ campaigns?: { campaign: SnapCampaign }[] }>(
      `/adaccounts/${adAccountExternalId}/campaigns`,
      accessToken,
      {},
      adAccountExternalId,
    );
    return (res.campaigns ?? []).map((e) => e.campaign);
  }

  async listAdSquads(
    accessToken: string,
    campaignExternalId: string,
    rateLimitExternalId?: string,
  ): Promise<SnapAdSquad[]> {
    const res = await this.get<{ adsquads?: { adsquad: SnapAdSquad }[] }>(
      `/campaigns/${campaignExternalId}/adsquads`,
      accessToken,
      {},
      rateLimitExternalId,
    );
    return (res.adsquads ?? []).map((e) => e.adsquad);
  }

  // Single-resource read used to resolve an ad squad's parent campaign id
  // before issuing a write that targets the parent-scoped path.
  async getAdSquad(
    accessToken: string,
    adSquadExternalId: string,
    rateLimitExternalId?: string,
  ): Promise<SnapAdSquad | null> {
    const res = await this.get<{ adsquads?: { adsquad: SnapAdSquad }[] }>(
      `/adsquads/${adSquadExternalId}`,
      accessToken,
      {},
      rateLimitExternalId,
    );
    return res.adsquads?.[0]?.adsquad ?? null;
  }

  async fetchStats(
    accessToken: string,
    entityKind: 'campaigns' | 'adsquads',
    externalId: string,
    startTime: string,
    endTime: string,
    fields: string[],
    rateLimitExternalId?: string,
  ): Promise<SnapStats | null> {
    const res = await this.get<{ total_stats?: { total_stat: SnapStats }[] }>(
      `/${entityKind}/${externalId}/stats`,
      accessToken,
      {
        granularity: 'TOTAL',
        fields:      fields.join(','),
        start_time:  startTime,
        end_time:    endTime,
      },
      rateLimitExternalId,
    );
    return res.total_stats?.[0]?.total_stat ?? null;
  }

  // Mutations live as path-specific helpers since the Snap API needs the
  // entity wrapped in a list (`{ campaigns: [{...}] }`, etc.). Provider code
  // uses these wrappers rather than constructing payloads inline.

  async updateCampaign(
    accessToken: string,
    adAccountExternalId: string,
    campaign: Record<string, unknown>,
  ): Promise<unknown> {
    return this.put<unknown>(
      `/adaccounts/${adAccountExternalId}/campaigns`,
      accessToken,
      { campaigns: [campaign] },
      adAccountExternalId,
    );
  }

  async updateAdSquad(
    accessToken: string,
    campaignExternalId: string,
    adSquad: Record<string, unknown>,
    rateLimitExternalId?: string,
  ): Promise<unknown> {
    return this.put<unknown>(
      `/campaigns/${campaignExternalId}/adsquads`,
      accessToken,
      { adsquads: [adSquad] },
      rateLimitExternalId,
    );
  }

  async put<T>(
    path: string,
    accessToken: string,
    body: Record<string, unknown>,
    rateLimitExternalId?: string,
  ): Promise<T> {
    return this.rawCall<T>('PUT', path, accessToken, { body }, rateLimitExternalId);
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
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await httpJson(url, 'SNAPCHAT', { method, headers, ...opts });

    if (!res.ok) throw this.mapError(res.status, res.body, res.headers);
    return res.body as T;
  }

  private mapError(
    status: number,
    body: unknown,
    headers: Headers,
  ): ProviderError {
    const env = body as SnapErrorBody | null;
    const message = env?.debug_message ?? env?.display_message ?? `Snapchat API error (status ${status})`;
    const providerCode = env?.error_code ?? String(status);

    let kind: ProviderErrorKind;
    if (status === 401) kind = ProviderErrorKind.INVALID_TOKEN;
    else if (status === 403) kind = ProviderErrorKind.UNAUTHORIZED;
    else if (status === 404) kind = ProviderErrorKind.NOT_FOUND;
    else if (status === 429) kind = ProviderErrorKind.RATE_LIMIT;
    else if (status >= 500) kind = ProviderErrorKind.PROVIDER_ERROR;
    else if (status === 400 || status === 422) kind = ProviderErrorKind.VALIDATION;
    else kind = ProviderErrorKind.UNKNOWN;

    const retryAfterHeader = headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

    return new ProviderError(kind, 'SNAPCHAT', message, {
      providerCode,
      retryAfterSeconds: Number.isNaN(retryAfterSeconds as number) ? null : retryAfterSeconds,
      raw: body,
    });
  }

  // OAuth endpoint errors arrive in a different shape ({error, error_description}).
  private mapOAuthError(
    status: number,
    body: unknown,
    _headers: Headers,
  ): ProviderError {
    const oauth = body as { error?: string; error_description?: string } | null;
    const message = oauth?.error_description ?? oauth?.error ?? `Snapchat OAuth error (status ${status})`;

    let kind: ProviderErrorKind;
    if (status === 401 || oauth?.error === 'invalid_grant') kind = ProviderErrorKind.INVALID_TOKEN;
    else if (status === 403) kind = ProviderErrorKind.UNAUTHORIZED;
    else if (status >= 500) kind = ProviderErrorKind.PROVIDER_ERROR;
    else if (status === 400) kind = ProviderErrorKind.VALIDATION;
    else kind = ProviderErrorKind.UNKNOWN;

    return new ProviderError(kind, 'SNAPCHAT', message, {
      providerCode: oauth?.error ?? String(status),
      raw: body,
    });
  }
}
