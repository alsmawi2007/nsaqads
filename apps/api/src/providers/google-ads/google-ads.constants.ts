// Centralized constants for Google Ads integration. apiVersion is now stored
// per-tenant in ProviderConfig (set via the System Admin Providers dashboard);
// this file is intentionally version-agnostic.

export const GOOGLE_ADS_BASE = 'https://googleads.googleapis.com';
export const GOOGLE_OAUTH_BASE = 'https://oauth2.googleapis.com';
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// Single scope is sufficient for read+write campaign management.
export const GOOGLE_ADS_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
];

// Mapping of normalized objectives → Google Ads advertising channel/sub-types
// or campaign-creation hints. Phase 1 only normalizes incoming data, so we
// reverse-map provider-side AdvertisingChannelType+SubType into Nasaq Ads objectives.
export const GOOGLE_OBJECTIVE_REVERSE: Record<string, string> = {
  SEARCH:                 'TRAFFIC',
  DISPLAY:                'AWARENESS',
  SHOPPING:               'CONVERSIONS',
  VIDEO:                  'AWARENESS',
  PERFORMANCE_MAX:        'CONVERSIONS',
  DISCOVERY:              'CONVERSIONS',
  HOTEL:                  'CONVERSIONS',
  LOCAL:                  'TRAFFIC',
  SMART:                  'CONVERSIONS',
  LOCAL_SERVICES:         'LEADS',
  TRAVEL:                 'CONVERSIONS',
  MULTI_CHANNEL:          'APP_INSTALLS',
};

// Google Ads campaign status → normalized EntityStatus.
// Possible source values: ENABLED | PAUSED | REMOVED | UNKNOWN | UNSPECIFIED
export const GOOGLE_STATUS_MAP: Record<string, 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'> = {
  ENABLED:    'ACTIVE',
  PAUSED:     'PAUSED',
  REMOVED:    'DELETED',
  UNKNOWN:    'PAUSED',
  UNSPECIFIED: 'PAUSED',
};

// Google Ads monetary fields are in MICROS (1_000_000 = 1 unit of currency).
// Nasaq Ads normalized values are in MAJOR units (account currency). Helpers
// avoid drift between micros and majors.
export const microsToMajor = (micros: string | number | null | undefined): number | null => {
  if (micros === null || micros === undefined || micros === '') return null;
  const n = typeof micros === 'string' ? parseFloat(micros) : micros;
  if (Number.isNaN(n)) return null;
  return n / 1_000_000;
};

export const majorToMicros = (major: number): string => Math.round(major * 1_000_000).toString();

// Google access tokens last ~1 hour. Refresh proactively when tokenExpiresAt
// falls within this many minutes of now; the daily scheduler also walks
// connections to keep refresh_tokens warm.
export const GOOGLE_TOKEN_REFRESH_WINDOW_MINUTES = 10;

// Customer IDs in Google Ads are 10-digit strings, typically displayed as
// 123-456-7890 but ALWAYS sent dash-free to the API. externalId in Nasaq Ads
// is the dash-free form.
export const stripDashes = (id: string): string => id.replace(/-/g, '');
