// Raw shapes returned by the Snapchat Marketing API. These types live ONLY
// inside the snapchat/ folder. The mapper converts them to Normalized*
// before they leave this directory. No code outside snapchat/ should
// reference these.
//
// Snap wraps every response in a top-level envelope, e.g.:
//   { request_status: 'SUCCESS', request_id: '...',
//     campaigns: [ { sub_request_status, campaign: {...} } ] }
//
// The api-client list helpers strip these envelopes and return the inner
// entity arrays directly.

// ─── Entity shapes ────────────────────────────────────────────────────────────

export interface SnapCampaign {
  id:                 string;
  name:               string;
  ad_account_id:      string;
  status:             string;          // ACTIVE | PAUSED
  objective?:         string;          // legacy
  objective_v2?:      string;          // new (preferred)
  daily_budget_micro?: number;         // ad-account currency micros
  lifetime_spend_cap_micro?: number;
  start_time?:        string;          // ISO 8601
  end_time?:          string;
  created_at?:        string;
  updated_at?:        string;
}

export interface SnapAdSquad {
  id:                 string;
  campaign_id:        string;
  name:               string;
  status:             string;
  type?:              string;          // SNAP_ADS, STORY, etc.
  daily_budget_micro?: number;
  lifetime_budget_micro?: number;
  bid_micro?:         number;          // bid amount (cap or target depending on bid_strategy)
  bid_strategy?:      string;          // AUTO_BID | MAX_BID | TARGET_COST | LOWEST_COST_WITH_MAX_BID
  billing_event?:     string;          // IMPRESSION
  optimization_goal?: string;          // SWIPES, IMPRESSIONS, PIXEL_PURCHASE, etc.
  start_time?:        string;
  end_time?:          string;
}

export interface SnapStatsRow {
  // The stats payload is a flat record. We list the metrics we actually use.
  // Snap returns numbers (not strings) for most metric fields.
  start_time?:    string;
  end_time?:      string;
  spend?:         number;        // micros
  impressions?:   number;
  swipes?:        number;        // closest analog to clicks
  conversions?:   number;        // unified conversions; field name depends on objective
  conversion_purchases?: number;
  conversion_purchases_value?: number;   // micros
  conversion_purchase_value_micro?: number;
  conversion_sign_ups?: number;
  uniques?:       number;
  frequency?:     number;
}

export interface SnapStats {
  id:        string;
  type:      'TOTAL' | 'CAMPAIGN' | 'AD_SQUAD' | 'AD' | string;
  granularity: 'TOTAL' | 'DAY' | 'HOUR' | string;
  // Either a single TOTAL bucket on the row…
  start_time?: string;
  end_time?:   string;
  // …or a `timeseries` array when granularity=DAY.
  timeseries?: SnapStatsRow[];
  // Flattened metrics for TOTAL granularity:
  spend?:         number;
  impressions?:   number;
  swipes?:        number;
  conversions?:   number;
  conversion_purchases?: number;
  conversion_purchases_value?: number;
  conversion_purchase_value_micro?: number;
  conversion_sign_ups?: number;
  uniques?:       number;
  frequency?:     number;
}

export interface SnapAdAccount {
  id:        string;
  name?:     string;
  currency?: string;
  timezone?: string;
  status?:   string;
  organization_id?: string;
}

export interface SnapOrganization {
  id:   string;
  name?: string;
}

// ─── OAuth + error shapes ─────────────────────────────────────────────────────

export interface SnapTokenResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in?:   number;       // seconds
  token_type?:   string;       // 'Bearer'
  scope?:        string;
}

export interface SnapErrorBody {
  request_status?: string;
  request_id?:     string;
  debug_message?:  string;
  display_message?: string;
  error_code?:     string;
}
