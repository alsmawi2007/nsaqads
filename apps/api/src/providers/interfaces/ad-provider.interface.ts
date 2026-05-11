// This is the single most important file in the codebase.
// The optimizer engine and all platform-facing code must use ONLY these types.
// No provider-specific field names or raw API objects may cross this boundary.

import type { AdAccountRef } from './ad-account-ref';
import type { ProviderCapabilities } from './provider-capabilities';

export type Platform = 'META' | 'TIKTOK' | 'GOOGLE_ADS' | 'SNAPCHAT' | 'TWITTER';

export type { AdAccountRef } from './ad-account-ref';
export type { ProviderCapabilities } from './provider-capabilities';

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

// ─── Draft Input Contracts (Campaign Architect: creation path) ───────────────
// Drafts carry only the fields needed to CREATE an entity. The externalId is
// assigned by the provider and returned in ProviderActionResult.externalId.

export interface NormalizedAudience {
  countries:     string[];                                      // ISO-3166-1 alpha-2
  cities:        string[] | null;
  radiusKm:      number | null;
  ageMin:        number;
  ageMax:        number;
  genders:       ('MALE' | 'FEMALE' | 'ALL')[];
  languages:     string[] | null;
  interestTags:  string[] | null;
}

export interface NormalizedCampaignDraft {
  name:           string;
  objective:      string;                      // normalized objective; provider maps to platform value
  status:         EntityStatus;                // typically ACTIVE or PAUSED at create time
  dailyBudget:    number | null;               // set if isCbo=true and budget is daily
  lifetimeBudget: number | null;               // set if isCbo=true and budget is lifetime
  isCbo:          boolean;
  startDate:      string | null;               // ISO date YYYY-MM-DD
  endDate:        string | null;
}

export interface NormalizedAdSetDraft {
  campaignExternalId: string;                  // from createCampaign result
  name:               string;
  status:             EntityStatus;
  dailyBudget:        number | null;           // required when parent campaign isCbo=false
  biddingStrategy:    BiddingStrategy;
  bidAmount:          number | null;           // required for COST_CAP/BID_CAP; null otherwise
  bidFloor:           number | null;
  bidCeiling:         number | null;
  audience:           NormalizedAudience;
  startDate:          string | null;
  endDate:            string | null;
}

export interface CreativeDraft {
  name:          string;
  assetRefs:     string[];                     // pre-existing asset identifiers (≥ 1 required)
  headline:      string | null;
  description:   string | null;
  cta:           string | null;
  landingUrl:    string | null;
}

export interface NormalizedAdDraft {
  adSetExternalId:    string;                  // from createAdSet result
  creativeExternalId: string;                  // from uploadCreative result
  name:               string;
  status:             EntityStatus;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

// ─── Optional context hints provided to read paths ───────────────────────────
// Some normalization decisions (especially conversion event mapping) depend
// on knowing the campaign's objective. Callers pass what they know; providers
// fall back to a sensible default when fields are absent.
export interface FetchMetricsHints {
  objective?: string;        // normalized objective; provider routes to the right conversion config
}

export interface IAdProvider {
  readonly platform: Platform;

  // Capability descriptor — see ProviderCapabilities for semantics. Static
  // per platform (does not depend on the account); the optimizer consults
  // this before proposing actions.
  getCapabilities(): ProviderCapabilities;

  validateCredentials(account: AdAccountRef): Promise<boolean>;
  refreshAccessToken(account: AdAccountRef): Promise<void>;

  fetchCampaigns(account: AdAccountRef): Promise<NormalizedCampaign[]>;
  fetchAdSets(account: AdAccountRef, campaignExternalId: string): Promise<NormalizedAdSet[]>;
  fetchMetrics(
    account: AdAccountRef,
    entityType: 'CAMPAIGN' | 'AD_SET',
    externalId: string,
    windowHours: 24 | 48 | 72,
    hints?: FetchMetricsHints,
  ): Promise<NormalizedMetrics>;

  updateBudget(account: AdAccountRef, params: UpdateBudgetParams): Promise<ProviderActionResult>;
  updateBiddingStrategy(
    account: AdAccountRef,
    params: UpdateBiddingStrategyParams,
  ): Promise<ProviderActionResult>;
  updateBidLimits(
    account: AdAccountRef,
    params: UpdateBidLimitsParams,
  ): Promise<ProviderActionResult>;

  // ─── Creation (Campaign Architect) ────────────────────────────────────────
  createCampaign(
    account: AdAccountRef,
    draft: NormalizedCampaignDraft,
  ): Promise<ProviderActionResult>;
  createAdSet(
    account: AdAccountRef,
    draft: NormalizedAdSetDraft,
  ): Promise<ProviderActionResult>;
  uploadCreative(
    account: AdAccountRef,
    draft: CreativeDraft,
  ): Promise<ProviderActionResult>;
  createAd(
    account: AdAccountRef,
    draft: NormalizedAdDraft,
  ): Promise<ProviderActionResult>;
}
