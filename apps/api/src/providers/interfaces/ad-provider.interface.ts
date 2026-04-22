// This is the single most important file in the codebase.
// The optimizer engine and all platform-facing code must use ONLY these types.
// No provider-specific field names or raw API objects may cross this boundary.

export type Platform = 'META' | 'TIKTOK' | 'GOOGLE_ADS' | 'SNAPCHAT';

export enum BiddingStrategy {
  LOWEST_COST = 'LOWEST_COST',
  COST_CAP    = 'COST_CAP',
  BID_CAP     = 'BID_CAP',
  TARGET_CPA  = 'TARGET_CPA',
  TARGET_ROAS = 'TARGET_ROAS',
}

export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED';

// ─── Normalized Data Contracts ────────────────────────────────────────────────

export interface NormalizedCampaign {
  externalId:     string;
  name:           string;
  status:         EntityStatus;
  objective:      string;
  dailyBudget:    number | null;
  lifetimeBudget: number | null;
  startDate:      string | null;   // ISO date YYYY-MM-DD
  endDate:        string | null;
  isCbo:          boolean;         // Campaign Budget Optimization active
}

export interface NormalizedAdSet {
  externalId:         string;
  campaignExternalId: string;
  name:               string;
  status:             EntityStatus;
  dailyBudget:        number | null;    // Only relevant when isCbo=false
  biddingStrategy:    BiddingStrategy;
  bidAmount:          number | null;    // Cost cap or bid cap; null for LOWEST_COST
  bidFloor:           number | null;
  bidCeiling:         number | null;
}

export interface NormalizedMetrics {
  externalId:  string;
  entityType:  'CAMPAIGN' | 'AD_SET';
  windowHours: 24 | 48 | 72;
  dateStart:   string;
  dateEnd:     string;
  spend:       number;
  impressions: number;
  clicks:      number;
  ctr:         number;         // ratio 0–1, not a percentage
  cpc:         number;
  conversions: number;
  cpa:         number;
  revenue:     number;
  roas:        number;
  reach:       number;
  frequency:   number;
  spendPacing: number;         // actualSpend / (dailyBudget * elapsedDayFraction)
}

// ─── Action Parameter Contracts ───────────────────────────────────────────────

export interface UpdateBudgetParams {
  entityType:     'CAMPAIGN' | 'AD_SET';
  externalId:     string;
  newDailyBudget: number;   // Absolute value in account currency
}

export interface UpdateBiddingStrategyParams {
  adSetExternalId: string;
  newStrategy:     BiddingStrategy;
  newBidAmount:    number | null;   // Required for COST_CAP/BID_CAP; null for LOWEST_COST
}

export interface UpdateBidLimitsParams {
  adSetExternalId: string;
  newBidFloor:     number | null;
  newBidCeiling:   number | null;
}

// ─── Provider Action Result ───────────────────────────────────────────────────

export interface ProviderActionResult {
  success:          boolean;
  externalId:       string;
  platform:         Platform;
  appliedAt:        string;         // ISO timestamp from provider confirmation
  errorCode:        string | null;
  errorMessage:     string | null;
  providerResponse: unknown;        // Raw response stored for debugging
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface IAdProvider {
  readonly platform: Platform;

  validateCredentials(adAccountId: string): Promise<boolean>;
  refreshAccessToken(adAccountId: string): Promise<void>;

  fetchCampaigns(adAccountId: string): Promise<NormalizedCampaign[]>;
  fetchAdSets(adAccountId: string, campaignExternalId: string): Promise<NormalizedAdSet[]>;
  fetchMetrics(
    adAccountId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    externalId: string,
    windowHours: 24 | 48 | 72,
  ): Promise<NormalizedMetrics>;

  updateBudget(adAccountId: string, params: UpdateBudgetParams): Promise<ProviderActionResult>;
  updateBiddingStrategy(
    adAccountId: string,
    params: UpdateBiddingStrategyParams,
  ): Promise<ProviderActionResult>;
  updateBidLimits(
    adAccountId: string,
    params: UpdateBidLimitsParams,
  ): Promise<ProviderActionResult>;
}
