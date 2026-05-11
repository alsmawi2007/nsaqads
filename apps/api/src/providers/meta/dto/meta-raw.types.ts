// Raw shapes returned by Meta Graph API. These types live ONLY inside the
// meta/ folder. The mapper converts them to Normalized* before they leave
// this directory. No code outside meta/ should reference these.

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;       // minor units (cents) — string per Graph API
  lifetime_budget?: string;
  start_time?: string;         // ISO 8601 with TZ
  stop_time?: string;
  budget_remaining?: string;
}

export interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  bid_amount?: string;
  optimization_goal?: string;
  billing_event?: string;
  start_time?: string;
  end_time?: string;
}

export interface MetaInsightsRow {
  date_start: string;          // YYYY-MM-DD
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;                // percentage in Meta API ('1.5' = 1.5%)
  cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

export interface MetaInsightsResponse {
  data: MetaInsightsRow[];
  paging?: { cursors: { before: string; after: string }; next?: string };
}

export interface MetaAdAccount {
  id: string;                  // 'act_<numeric>'
  account_id: string;          // numeric only
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

export interface MetaError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export interface MetaErrorEnvelope {
  error: MetaError;
}

export interface MetaTokenExchangeResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;         // seconds
}

export interface MetaPaged<T> {
  data: T[];
  paging?: { cursors?: { before: string; after: string }; next?: string };
}
