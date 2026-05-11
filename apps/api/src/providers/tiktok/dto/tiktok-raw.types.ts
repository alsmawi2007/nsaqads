// Raw shapes returned by the TikTok Marketing API. These types live ONLY
// inside the tiktok/ folder. The mapper converts them to Normalized*
// before they leave this directory. No code outside tiktok/ should
// reference these.
//
// TikTok wraps every response in an envelope:
//   { code: 0, message: 'OK', request_id: '...', data: { list: [...] } }
// `code !== 0` is an error EVEN ON HTTP 200. The api-client unwraps
// `data` on success and throws ProviderError when code !== 0.

// ─── Envelope ─────────────────────────────────────────────────────────────────

export interface TikTokEnvelope<T> {
  code:        number;
  message:     string;
  request_id?: string;
  data?:       T;
}

// ─── Entity shapes ────────────────────────────────────────────────────────────

export interface TikTokAdvertiser {
  advertiser_id:   string;
  advertiser_name?: string;
  currency?:       string;
  timezone?:       string;
  display_timezone?: string;
  status?:         string;
}

export interface TikTokCampaign {
  campaign_id:        string;
  campaign_name:      string;
  advertiser_id:      string;
  objective_type?:    string;     // e.g. 'CONVERSIONS', 'TRAFFIC'
  objective?:         string;     // legacy alias
  budget?:            number;     // major units, daily or lifetime depending on budget_mode
  budget_mode?:       string;     // 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL' | 'BUDGET_MODE_INFINITE'
  operation_status?:  string;     // 'ENABLE' | 'DISABLE' | 'DELETE'
  secondary_status?:  string;     // 'CAMPAIGN_STATUS_DELIVERY_OK', etc.
  campaign_type?:     string;     // 'REGULAR_CAMPAIGN' | 'IOS14_CAMPAIGN'
  // Top-level lifetime/daily flags. TikTok exposes a single `budget` field;
  // budget_mode disambiguates. We surface lifetime separately for clarity.
  schedule_start_time?: string;   // ISO 8601
  schedule_end_time?:   string;
  create_time?:         string;
  modify_time?:         string;
}

export interface TikTokAdGroup {
  adgroup_id:         string;
  adgroup_name:       string;
  campaign_id:        string;
  advertiser_id:      string;
  budget?:            number;     // major units
  budget_mode?:       string;
  bid_type?:          string;     // 'BID_TYPE_CUSTOM' | 'BID_TYPE_NO_BID' | 'BID_TYPE_MAX_CONVERSION'
  bid_price?:         number;     // bid cap value (major units)
  conversion_bid_price?: number;  // CPA target (major units)
  optimization_goal?: string;     // 'CONVERSION' | 'CLICK' | 'REACH' | etc.
  billing_event?:     string;     // 'CPC' | 'CPM' | 'OCPM'
  pacing?:            string;     // 'PACING_MODE_SMOOTH' | 'PACING_MODE_FAST'
  operation_status?:  string;
  secondary_status?:  string;
  schedule_start_time?: string;
  schedule_end_time?:   string;
}

export interface TikTokStatsRow {
  // TikTok reports return a `metrics` block plus a `dimensions` block. The
  // api-client flattens to this row shape before passing to the mapper.
  stat_time_day?:  string;       // 'YYYY-MM-DD HH:MM:SS' (only when granularity=DAY)
  spend?:          string | number;
  impressions?:    string | number;
  clicks?:         string | number;
  conversions?:    string | number;
  conversion_rate?:string | number;
  cost_per_conversion?: string | number;
  cpc?:            string | number;
  cpm?:            string | number;
  ctr?:            string | number;
  reach?:          string | number;
  frequency?:      string | number;
  // Revenue-bearing fields. TikTok exposes `total_purchase_value`,
  // `complete_payment_roas` and a few app-event variants. Values are major
  // units (account currency).
  total_purchase_value?: string | number;
  total_complete_payment_rate?: string | number;
  complete_payment_roas?: string | number;
  // App-promotion conversions
  total_active_pay_roas?: string | number;
  app_event_purchase?: string | number;
  app_event_purchase_value?: string | number;
}

// Wrapper returned by /report/integrated/get/. List of rows where each row
// carries dimensions + metrics; api-client flattens metrics onto the row.
export interface TikTokReportRow {
  metrics?:    Record<string, string | number>;
  dimensions?: Record<string, string>;
}

// ─── OAuth + error shapes ─────────────────────────────────────────────────────

// /oauth2/access_token/ response. TikTok puts the actual data under `data`;
// we surface it flat here after the api-client unwraps the envelope.
export interface TikTokTokenResponse {
  access_token:      string;
  refresh_token?:    string;
  access_token_expire_in?: number;     // seconds
  refresh_token_expire_in?: number;
  advertiser_ids?:   string[];
  scope?:            number[];         // bitmask array
  token_type?:       string;
}

export interface TikTokAdvertiserListResponse {
  list: { advertiser_id: string; advertiser_name?: string }[];
}
