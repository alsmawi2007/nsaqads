// Raw shapes returned by the Google Ads REST API. These types live ONLY
// inside the google-ads/ folder. The mapper converts them to Normalized*
// before they leave this directory. No code outside google-ads/ should
// reference these types.

// ─── Search API (GAQL) result rows ────────────────────────────────────────

// A single row of `googleAds.search` results. Fields are nested under their
// resource name (campaign, ad_group, metrics, etc.). Only fields the mapper
// needs are typed; the rest are ignored.
export interface GoogleAdsSearchResponse {
  results?: GoogleAdsSearchRow[];
  nextPageToken?: string;
  totalResultsCount?: string;
}

export interface GoogleAdsSearchRow {
  campaign?: GoogleAdsCampaignFields;
  campaignBudget?: GoogleAdsCampaignBudgetFields;
  adGroup?: GoogleAdsAdGroupFields;
  metrics?: GoogleAdsMetricsFields;
  segments?: GoogleAdsSegmentsFields;
  customer?: GoogleAdsCustomerFields;
}

export interface GoogleAdsCampaignFields {
  resourceName?: string;
  id?: string;
  name?: string;
  status?: string;                       // ENABLED | PAUSED | REMOVED | ...
  advertisingChannelType?: string;       // SEARCH | DISPLAY | SHOPPING | VIDEO | ...
  advertisingChannelSubType?: string;
  startDate?: string;                    // YYYY-MM-DD or YYYYMMDD
  endDate?: string;
  biddingStrategyType?: string;          // MANUAL_CPC | MAXIMIZE_CONVERSIONS | TARGET_CPA | TARGET_ROAS | ...
  manualCpc?: { enhancedCpcEnabled?: boolean };
  targetCpa?: { targetCpaMicros?: string; cpcBidCeilingMicros?: string; cpcBidFloorMicros?: string };
  targetRoas?: { targetRoas?: number; cpcBidCeilingMicros?: string; cpcBidFloorMicros?: string };
  campaignBudget?: string;               // resource name 'customers/.../campaignBudgets/...'
}

export interface GoogleAdsCampaignBudgetFields {
  resourceName?: string;
  id?: string;
  amountMicros?: string;
  totalAmountMicros?: string;
  period?: string;                       // DAILY | CUSTOM_PERIOD | ...
  explicitlyShared?: boolean;
}

export interface GoogleAdsAdGroupFields {
  resourceName?: string;
  id?: string;
  name?: string;
  status?: string;
  campaign?: string;                     // resource name 'customers/.../campaigns/...'
  cpcBidMicros?: string;
  cpmBidMicros?: string;
  targetCpaMicros?: string;
}

export interface GoogleAdsMetricsFields {
  costMicros?: string;
  impressions?: string;
  clicks?: string;
  ctr?: number;                          // ratio 0–1 in v17+
  averageCpc?: string;                   // micros
  conversions?: number;
  conversionsValue?: number;             // already in major units
  costPerConversion?: string;            // micros
  valuePerConversion?: number;
}

export interface GoogleAdsSegmentsFields {
  date?: string;                         // YYYY-MM-DD
}

export interface GoogleAdsCustomerFields {
  resourceName?: string;
  id?: string;
  descriptiveName?: string;
  currencyCode?: string;
  timeZone?: string;
  manager?: boolean;
  testAccount?: boolean;
}

// ─── List Accessible Customers ────────────────────────────────────────────

export interface GoogleListAccessibleCustomersResponse {
  resourceNames?: string[];              // 'customers/1234567890'
}

// ─── OAuth token endpoint ─────────────────────────────────────────────────

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;                    // seconds
  refresh_token?: string;                // present only on first-time consent
  scope?: string;
  token_type?: string;                   // 'Bearer'
  id_token?: string;
}

// ─── Error envelope ───────────────────────────────────────────────────────

export interface GoogleAdsError {
  code?: number;
  message?: string;
  status?: string;                       // 'UNAUTHENTICATED' | 'PERMISSION_DENIED' | ...
  details?: Array<{
    '@type'?: string;
    errors?: Array<{
      errorCode?: Record<string, string>;
      message?: string;
      trigger?: { stringValue?: string; int64Value?: string };
      location?: unknown;
    }>;
    requestId?: string;
  }>;
}

export interface GoogleAdsErrorEnvelope {
  error?: GoogleAdsError;
}

// ─── Mutate operation responses (writes) ──────────────────────────────────

export interface GoogleAdsMutateResponse {
  results?: Array<{ resourceName?: string }>;
  partialFailureError?: GoogleAdsError;
}
