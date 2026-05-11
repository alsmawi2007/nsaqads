// Rate limiter contract — currently a NO-OP (Phase 1 ships without
// per-account throttling). The interface exists so that provider adapters
// can call `acquire(key)` before every outbound HTTP call without knowing
// whether throttling is wired in. When we plug a Redis-backed token bucket
// later, only the binding inside ProvidersModule changes.
//
// Throttling key convention (used by future implementations):
//   `${platform}:${externalId}` — per-account bucket
//   `${platform}:app`           — per-app bucket (Meta has both)
//
// Future implementation sketches:
//   - RedisRateLimiter: Lua INCR + EXPIRE token bucket, distributed-safe
//   - PerAccountWindowedLimiter: in-memory sliding window, single-process
//   - QuotaPolicy: pulls limits from AdminSettings so ops can tune without redeploy
export interface RateLimiter {
  // Block until the caller is allowed to proceed. Throws ProviderError of
  // kind RATE_LIMIT only if the caller has explicitly opted out of waiting
  // (not used in Phase 1).
  acquire(key: string): Promise<void>;
}

// Default Phase 1 implementation: never blocks, never throws.
// All providers use this until a real limiter is wired in.
export class NoopRateLimiter implements RateLimiter {
  async acquire(_key: string): Promise<void> {
    // Intentional no-op. Replaced by RedisRateLimiter in Phase 2.
  }
}

// DI token — providers inject RATE_LIMITER (string token) so the binding
// can be swapped without touching consumer code.
export const RATE_LIMITER = 'RATE_LIMITER';
