import type { Platform } from '../interfaces/ad-provider.interface';

// Single normalized error vocabulary used by every provider implementation.
// The optimizer + ingestion layers branch on `kind`, never on platform-specific codes.
export enum ProviderErrorKind {
  RATE_LIMIT     = 'RATE_LIMIT',     // back off and retry later
  UNAUTHORIZED   = 'UNAUTHORIZED',   // missing scope / forbidden
  INVALID_TOKEN  = 'INVALID_TOKEN',  // expired or revoked — re-auth required
  NOT_FOUND      = 'NOT_FOUND',      // entity does not exist
  VALIDATION     = 'VALIDATION',     // bad parameter shape; retry won't help
  NETWORK        = 'NETWORK',        // socket / DNS / TLS — transient
  PROVIDER_ERROR = 'PROVIDER_ERROR', // 5xx from provider — transient
  UNKNOWN        = 'UNKNOWN',
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly platform: Platform;
  readonly providerCode: string | null;
  readonly retryAfterSeconds: number | null;
  readonly raw: unknown;

  constructor(
    kind: ProviderErrorKind,
    platform: Platform,
    message: string,
    opts?: { providerCode?: string | null; retryAfterSeconds?: number | null; raw?: unknown },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.platform = platform;
    this.providerCode = opts?.providerCode ?? null;
    this.retryAfterSeconds = opts?.retryAfterSeconds ?? null;
    this.raw = opts?.raw ?? null;
  }

  // Reads + idempotent ops are safe to retry on these.
  isRetryable(): boolean {
    return (
      this.kind === ProviderErrorKind.RATE_LIMIT ||
      this.kind === ProviderErrorKind.NETWORK ||
      this.kind === ProviderErrorKind.PROVIDER_ERROR
    );
  }
}
