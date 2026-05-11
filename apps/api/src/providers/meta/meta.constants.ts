// Centralized constants for Meta Ads integration. Bump apiVersion in
// provider.config (env: META_API_VERSION) when migrating; this file is
// intentionally version-agnostic.

export const META_GRAPH_BASE = 'https://graph.facebook.com';

// OAuth scopes — minimum required for read+write campaign management.
// `ads_management` covers create/update; `ads_read` covers insights;
// `business_management` is needed to enumerate /me/adaccounts.
export const META_OAUTH_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
];

// Mapping of normalized objectives → Meta campaign objectives.
// Meta deprecated old-style objectives in v15+; we use the ODAX names.
export const META_OBJECTIVE_MAP: Record<string, string> = {
  CONVERSIONS: 'OUTCOME_SALES',
  TRAFFIC:     'OUTCOME_TRAFFIC',
  AWARENESS:   'OUTCOME_AWARENESS',
  LEADS:       'OUTCOME_LEADS',
  ENGAGEMENT:  'OUTCOME_ENGAGEMENT',
  APP_INSTALLS:'OUTCOME_APP_PROMOTION',
};

// Reverse direction for ingestion paths.
export const META_OBJECTIVE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(META_OBJECTIVE_MAP).map(([k, v]) => [v, k]),
);

// Meta status → normalized EntityStatus.
export const META_STATUS_MAP: Record<string, 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED'> = {
  ACTIVE:    'ACTIVE',
  PAUSED:    'PAUSED',
  ARCHIVED:  'ARCHIVED',
  DELETED:   'DELETED',
};

// Meta budgets are stored in MINOR units (cents). Nasaq Ads normalized values
// are in account currency (major units). Helpers below avoid drift.
export const minorToMajor = (minor: string | number | null | undefined): number | null => {
  if (minor === null || minor === undefined || minor === '') return null;
  const n = typeof minor === 'string' ? parseInt(minor, 10) : minor;
  if (Number.isNaN(n)) return null;
  return n / 100;
};

export const majorToMinor = (major: number): string => Math.round(major * 100).toString();

// Long-lived access tokens last ~60 days. Refresh proactively when
// tokenExpiresAt is within this many days of now.
export const META_TOKEN_REFRESH_WINDOW_DAYS = 7;
