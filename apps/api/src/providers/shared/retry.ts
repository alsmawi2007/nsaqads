import { ProviderError, ProviderErrorKind } from './provider-error';

// Used by read + idempotent write paths only. Mutating non-idempotent calls
// (createCampaign, updateBudget) must NOT pass through this helper — retrying
// them risks duplicate spend or duplicate entities.
export interface RetryOptions {
  maxAttempts?: number;     // total tries including the first
  baseDelayMs?: number;     // initial backoff
  maxDelayMs?: number;      // cap
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...opts };
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === maxAttempts;
      const retryable = err instanceof ProviderError ? err.isRetryable() : false;
      if (isLast || !retryable) throw err;

      // RATE_LIMIT errors carry retryAfterSeconds when the provider tells us;
      // otherwise fall back to exponential backoff with jitter.
      let delay: number;
      if (
        err instanceof ProviderError &&
        err.kind === ProviderErrorKind.RATE_LIMIT &&
        typeof err.retryAfterSeconds === 'number'
      ) {
        delay = Math.min(err.retryAfterSeconds * 1000, maxDelayMs);
      } else {
        const exp = baseDelayMs * 2 ** (attempt - 1);
        const jitter = Math.random() * baseDelayMs;
        delay = Math.min(exp + jitter, maxDelayMs);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
