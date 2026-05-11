import { Inject, Injectable, Logger } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { ProviderConfigsService } from '../../provider-configs/provider-configs.service';
import { httpJson, HttpJsonOptions } from '../shared/http-json';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { withRetry } from '../shared/retry';
import { RATE_LIMITER, RateLimiter } from '../shared/rate-limiter';
import { META_GRAPH_BASE } from './meta.constants';
import {
  MetaErrorEnvelope,
  MetaPaged,
  MetaTokenExchangeResponse,
  MetaAdAccount,
} from './dto/meta-raw.types';

// Thin Meta-flavored wrapper over httpJson:
//   - prefixes Graph base + version (version comes from ProviderConfigsService)
//   - injects access_token query param
//   - normalizes Meta error envelopes to ProviderError
//   - exposes a paginated GET helper
//   - calls RateLimiter.acquire() before every outbound HTTP call
//
// All real Meta calls go through this client. Nothing else in meta/ should
// call fetch directly. apiVersion + appId + appSecret are loaded per-call
// from ProviderConfigsService (cached in-memory for 60s).

@Injectable()
export class MetaApiClient {
  private readonly logger = new Logger(MetaApiClient.name);

  constructor(
    private readonly providerConfigs: ProviderConfigsService,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
  ) {}

  private async base(): Promise<string> {
    const cfg = await this.providerConfigs.getEnabled(Platform.META);
    return `${META_GRAPH_BASE}/${cfg.apiVersion ?? 'v21.0'}`;
  }

  // Rate-limit key for an account-scoped call. Apps without a known account
  // (OAuth exchange, /me) use a 'meta:app' bucket.
  private rlKey(externalId?: string | null): string {
    return externalId ? `meta:${externalId}` : 'meta:app';
  }

  // ─── Generic GET (read paths use this — wrapped in withRetry) ────────────
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

  // ─── Form-encoded POST (used for OAuth token exchange) ───────────────────
  async postForm<T>(path: string, body: URLSearchParams): Promise<T> {
    return this.rawCall<T>('POST', path, null, { body });
  }

  // ─── Paginated GET — follows the `next` cursor until exhausted ───────────
  async getPaginated<T>(
    path: string,
    accessToken: string,
    query: HttpJsonOptions['query'] = {},
    rateLimitExternalId?: string,
    maxPages = 20,
  ): Promise<T[]> {
    const out: T[] = [];
    let nextUrl: string | null = null;
    let page = 0;
    const baseUrl = await this.base();

    do {
      const url: string = nextUrl ?? `${baseUrl}${path}`;
      const useQuery = nextUrl === null;
      const result: MetaPaged<T> = await withRetry(() =>
        this.rawCallAbsolute<MetaPaged<T>>(
          'GET',
          url,
          accessToken,
          useQuery ? { query } : {},
          rateLimitExternalId,
        ),
      );
      out.push(...(result.data ?? []));
      nextUrl = result.paging?.next ?? null;
      page += 1;
    } while (nextUrl && page < maxPages);

    return out;
  }

  // ─── OAuth helpers ────────────────────────────────────────────────────────
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<MetaTokenExchangeResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.META);
    return this.rawCall<MetaTokenExchangeResponse>(
      'GET',
      '/oauth/access_token',
      null,
      {
        query: {
          client_id:     cfg.appId,
          client_secret: cfg.appSecret,
          redirect_uri:  redirectUri,
          code,
        },
      },
    );
  }

  async exchangeForLongLivedToken(
    shortLivedToken: string,
  ): Promise<MetaTokenExchangeResponse> {
    const cfg = await this.providerConfigs.getEnabled(Platform.META);
    return this.rawCall<MetaTokenExchangeResponse>(
      'GET',
      '/oauth/access_token',
      null,
      {
        query: {
          grant_type:        'fb_exchange_token',
          client_id:         cfg.appId,
          client_secret:     cfg.appSecret,
          fb_exchange_token: shortLivedToken,
        },
      },
    );
  }

  async listMyAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
    return this.getPaginated<MetaAdAccount>(
      '/me/adaccounts',
      accessToken,
      { fields: 'id,account_id,name,currency,timezone_name,account_status' },
    );
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  private async rawCall<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    accessToken: string | null,
    opts: { query?: HttpJsonOptions['query']; body?: HttpJsonOptions['body'] },
    rateLimitExternalId?: string,
  ): Promise<T> {
    const url = `${await this.base()}${path}`;
    return this.rawCallAbsolute<T>(method, url, accessToken, opts, rateLimitExternalId);
  }

  private async rawCallAbsolute<T>(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    accessToken: string | null,
    opts: { query?: HttpJsonOptions['query']; body?: HttpJsonOptions['body'] },
    rateLimitExternalId?: string,
  ): Promise<T> {
    await this.rateLimiter.acquire(this.rlKey(rateLimitExternalId));

    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await httpJson(url, 'META', { method, headers, ...opts });

    if (!res.ok) throw this.mapError(res.status, res.body, res.headers);
    return res.body as T;
  }

  private mapError(
    status: number,
    body: unknown,
    headers: Headers,
  ): ProviderError {
    const envelope = body as MetaErrorEnvelope | null;
    const err = envelope?.error;
    const message = err?.message ?? `Meta API error (status ${status})`;
    const code = err?.code ?? null;
    const subcode = err?.error_subcode ?? null;
    const providerCode = code !== null ? `${code}${subcode ? `/${subcode}` : ''}` : String(status);

    let kind: ProviderErrorKind;
    if (code === 190) kind = ProviderErrorKind.INVALID_TOKEN;
    else if (code === 4 || code === 17 || code === 32 || code === 368 || status === 429) {
      kind = ProviderErrorKind.RATE_LIMIT;
    } else if (status === 401 || status === 403) kind = ProviderErrorKind.UNAUTHORIZED;
    else if (status === 404) kind = ProviderErrorKind.NOT_FOUND;
    else if (status >= 500) kind = ProviderErrorKind.PROVIDER_ERROR;
    else if (code === 100 || code === 200) kind = ProviderErrorKind.VALIDATION;
    else kind = ProviderErrorKind.UNKNOWN;

    const retryAfterHeader = headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : null;

    return new ProviderError(kind, 'META', message, {
      providerCode,
      retryAfterSeconds: Number.isNaN(retryAfterSeconds as number) ? null : retryAfterSeconds,
      raw: body,
    });
  }
}
