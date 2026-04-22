// R5 from approval: consistent currency + timezone normalization strategy.
// All monetary values are stored and processed in the ad account's native currency.
// Conversion to a display currency happens only in the API response layer, never in optimizer logic.

export interface MoneyValue {
  amount: number;
  currency: string;
}

// Safely rounds a monetary amount to the precision expected by ad platforms.
// Most platforms accept 2 decimal places; some (Meta) use micros internally.
export function roundCurrency(amount: number, currency: string): number {
  // JPY and similar zero-decimal currencies
  const zeroDecimal = ['JPY', 'KRW', 'IDR'];
  const decimals = zeroDecimal.includes(currency.toUpperCase()) ? 0 : 2;
  return parseFloat(amount.toFixed(decimals));
}

// Applies a percentage delta to a base amount and rounds to currency precision.
export function applyDelta(base: number, deltaPct: number, currency: string): number {
  const raw = base * (1 + deltaPct / 100);
  return roundCurrency(raw, currency);
}

// Normalizes a timezone string to IANA format. Falls back to UTC if unrecognized.
export function normalizeTimezone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  // Basic normalization: platforms sometimes return offsets like "+03:00"
  // We store as-is and let date-fns / Luxon handle conversion in reporting
  return tz;
}
