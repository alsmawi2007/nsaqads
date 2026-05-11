// Centralized constants for TikTok Ads integration. apiVersion is loaded
// per-call from ProviderConfigsService (DB-backed); this file is
// intentionally version-agnostic.

export const TIKTOK_API_BASE        = 'https://business-api.tiktok.com/open_api';
export const TIKTOK_OAUTH_AUTHORIZE = 'https://business-api.tiktok.com/portal/auth';
export const TIKTOK_OAUTH_TOKEN     = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';
export const TIKTOK_OAUTH_ADVERTISERS = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/';

// TikTok configures scopes at the app level rather than the OAuth request,
// so we do not pass `scope` in the authorize URL. Required app scopes for
// Phase 1: Ad Account Management, Campaign Management, Ad Group Management,
// Reporting (configured in business-api.tiktok.com → Apps → Permissions).

// Mapping of normalized objectives → TikTok campaign objective_type.
export const TIKTOK_OBJECTIVE_MAP: Record<string, string> = {
  CONVERSIONS:  'CONVERSIONS',
  TRAFFIC:      'TRAFFIC',
  AWARENESS:    'REACH',
  LEADS:        'LEAD_GENERATION',
  ENGAGEMENT:   'ENGAGEMENT',
  APP_INSTALLS: 'APP_PROMOTION',
  VIDEO_VIEWS:  'VIDEO_VIEWS',
};

export const TIKTOK_OBJECTIVE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TIKTOK_OBJECTIVE_MAP).map(([k, v]) => [v, k]),
);

// TikTok status values. Operation status uses ENABLE/DISABLE while secondary
// status carries the lifecycle (DELIVERY_OK, CAMPAIGN_PAUSE, AD_GROUP_DELETE…).
// The mapper checks operation_status first, then falls back to secondary.
export const TIKTOK_STATUS_MAP: Record<string, 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'> = {
  ENABLE:           'ACTIVE',
  DISABLE:          'PAUSED',
  DELETE:           'DELETED',
  CAMPAIGN_PAUSE:   'PAUSED',
  CAMPAIGN_DELETE:  'DELETED',
  CAMPAIGN_STATUS_ENABLE:  'ACTIVE',
  CAMPAIGN_STATUS_DISABLE: 'PAUSED',
  ADGROUP_STATUS_DELIVERY_OK:    'ACTIVE',
  ADGROUP_STATUS_CAMPAIGN_DISABLE:'PAUSED',
  ADGROUP_STATUS_DISABLE:        'PAUSED',
  ADGROUP_STATUS_DELETE:         'DELETED',
};

// TikTok budgets and bids are stored in MAJOR units of the account currency
// (e.g. 100 == 100 USD), unlike Snap/Google which use micros. No conversion
// helper is needed — the mapper passes values through.

// Access tokens are long-lived (~24 h) but the Marketing API issues a
// refresh_token. We refresh proactively when the expiry is within this
// many seconds of now. Hourly cron + 30-minute window keeps tokens fresh.
export const TIKTOK_TOKEN_REFRESH_WINDOW_SECONDS = 30 * 60;   // 30 minutes
