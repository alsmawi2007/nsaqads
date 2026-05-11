// Centralized constants for Snapchat Ads integration. apiVersion is loaded
// per-call from ProviderConfigsService (DB-backed); this file is
// intentionally version-agnostic.

export const SNAP_API_BASE   = 'https://adsapi.snapchat.com';
export const SNAP_OAUTH_AUTHORIZE = 'https://accounts.snapchat.com/login/oauth2/authorize';
export const SNAP_OAUTH_TOKEN     = 'https://accounts.snapchat.com/login/oauth2/access_token';

// OAuth scopes — `snapchat-marketing-api` is the umbrella scope that covers
// read + write on campaigns, ad squads, ads, and creatives.
export const SNAP_OAUTH_SCOPES = ['snapchat-marketing-api'];

// Mapping of normalized objectives → Snapchat campaign objectives.
// Snap uses an `objective` enum at the campaign level alongside an
// `objective_v2` field; we map to the v2 names where possible.
export const SNAP_OBJECTIVE_MAP: Record<string, string> = {
  CONVERSIONS:  'WEB_CONVERSION',
  TRAFFIC:      'WEBSITE_TRAFFIC',
  AWARENESS:    'BRAND_AWARENESS',
  LEADS:        'LEAD_GENERATION',
  ENGAGEMENT:   'ENGAGEMENT',
  APP_INSTALLS: 'APP_INSTALL',
};

// Reverse direction for ingestion paths.
export const SNAP_OBJECTIVE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(SNAP_OBJECTIVE_MAP).map(([k, v]) => [v, k]),
);

// Snapchat status → normalized EntityStatus. Snap exposes status as one of
// ACTIVE, PAUSED. ARCHIVED is represented by an `is_archived` flag; DELETED
// entities are typically filtered out at the API level.
export const SNAP_STATUS_MAP: Record<string, 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'> = {
  ACTIVE:   'ACTIVE',
  PAUSED:   'PAUSED',
  ARCHIVED: 'ARCHIVED',
  DELETED:  'DELETED',
};

// Snapchat budgets and bids are stored in MICROS (millionths of the account
// currency, like Google Ads). Nasaq Ads normalized values are major units.
const MICROS_PER_UNIT = 1_000_000;

export const microsToMajor = (micros: string | number | null | undefined): number | null => {
  if (micros === null || micros === undefined || micros === '') return null;
  const n = typeof micros === 'string' ? parseInt(micros, 10) : micros;
  if (Number.isNaN(n)) return null;
  return n / MICROS_PER_UNIT;
};

export const majorToMicros = (major: number): number => Math.round(major * MICROS_PER_UNIT);

// Access tokens last ~30 minutes. Refresh proactively when tokenExpiresAt
// is within this many seconds of now. We refresh aggressively because the
// expiry window is short relative to the optimizer cycle.
export const SNAP_TOKEN_REFRESH_WINDOW_SECONDS = 5 * 60;   // 5 minutes
