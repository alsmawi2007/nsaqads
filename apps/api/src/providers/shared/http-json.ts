import { ProviderError, ProviderErrorKind } from './provider-error';
import type { Platform } from '../interfaces/ad-provider.interface';

// Thin wrapper around fetch with timeout, JSON handling, and ProviderError
// normalization. Each platform adapter wraps this with its own error mapper
// (see meta/meta-api.client.ts) — this layer is platform-agnostic.

export interface HttpJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: Record<string, unknown> | URLSearchParams;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpRawResponse {
  status: number;
  ok: boolean;
  body: unknown;       // parsed JSON if Content-Type: application/json, else raw string
  headers: Headers;
}

export async function httpJson(
  url: string,
  platform: Platform,
  opts: HttpJsonOptions = {},
): Promise<HttpRawResponse> {
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const finalUrl = appendQuery(url, opts.query);
  const init: RequestInit = { method, headers: { ...(opts.headers ?? {}) } };

  if (opts.body !== undefined) {
    if (opts.body instanceof URLSearchParams) {
      init.body = opts.body.toString();
      (init.headers as Record<string, string>)['Content-Type'] =
        'application/x-www-form-urlencoded';
    } else {
      init.body = JSON.stringify(opts.body);
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let res: Response;
  try {
    res = await fetch(finalUrl, init);
  } catch (err) {
    const isAbort = (err as { name?: string }).name === 'AbortError';
    throw new ProviderError(
      ProviderErrorKind.NETWORK,
      platform,
      isAbort ? `Request timed out after ${timeoutMs}ms` : `Network error: ${(err as Error).message}`,
      { raw: err },
    );
  } finally {
    clearTimeout(timeout);
  }

  const contentType = res.headers.get('content-type') ?? '';
  let body: unknown;
  if (contentType.includes('application/json')) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.text().catch(() => '');
  }

  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

function appendQuery(
  url: string,
  query: HttpJsonOptions['query'],
): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}
