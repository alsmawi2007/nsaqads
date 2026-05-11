// Conversion configuration for Google Ads.
//
// Unlike Meta (where `actions` is a heterogeneous list and we filter by
// `action_type`), Google Ads pre-aggregates the conversion count into
// `metrics.conversions` based on the customer's configured Conversion Actions
// in Google Ads UI. The platform itself decides what counts.
//
// What we configure here is OBJECTIVE-AWARE FILTERING for cases where the
// raw `metrics.conversions` value would over- or under-count for the
// optimizer's purposes. Phase 1 default: trust the platform-aggregated value
// for every objective.
//
// The shape mirrors meta-conversion-config.ts so a future refactor can lift
// the type into a shared location.

export interface GoogleAdsConversionMapping {
  // Whether to include the platform's pre-aggregated conversions value.
  // Set to false for objectives where the platform's "conversions" doesn't
  // align with our optimizer signal (e.g. AWARENESS — we should ignore).
  useAggregatedConversions: boolean;

  // Whether to include conversionsValue as revenue. For LEADS/AWARENESS,
  // most accounts don't assign monetary value, so this can be false.
  useConversionValue: boolean;
}

// Keyed by NORMALIZED objective.
export const DEFAULT_GOOGLE_ADS_CONVERSION_MAP: Record<string, GoogleAdsConversionMapping> = {
  CONVERSIONS: {
    useAggregatedConversions: true,
    useConversionValue:       true,
  },
  LEADS: {
    useAggregatedConversions: true,
    useConversionValue:       false,
  },
  TRAFFIC: {
    useAggregatedConversions: false, // traffic objective — clicks are the goal
    useConversionValue:       false,
  },
  AWARENESS: {
    useAggregatedConversions: false,
    useConversionValue:       false,
  },
  ENGAGEMENT: {
    useAggregatedConversions: true,
    useConversionValue:       false,
  },
  APP_INSTALLS: {
    useAggregatedConversions: true,
    useConversionValue:       false,
  },
};

export const GOOGLE_ADS_CONVERSION_FALLBACK: GoogleAdsConversionMapping = {
  useAggregatedConversions: true,
  useConversionValue:       true,
};

// DI token. Injecting this (rather than importing the constant directly)
// lets us swap in an org-aware resolver later.
export const GOOGLE_ADS_CONVERSION_MAP = 'GOOGLE_ADS_CONVERSION_MAP';
