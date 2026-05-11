// Conversion event mapping — controls which Meta `actions` and `action_values`
// rows count as "conversions" and "revenue" when normalizing insights.
//
// Why per-objective: a CONVERSIONS campaign optimizing for purchases should
// NOT count `link_click` as a conversion; a TRAFFIC campaign should. Hardcoding
// a single union of action types (the previous Phase-1 behavior) over-counted
// for traffic campaigns and under-counted for lead-gen campaigns.
//
// Why a typed config: lifting the map out of the mapper makes it injectable
// (per-org overrides via AdminSettings later) and keeps the mapper pure.

export interface ConversionMapping {
  // Action types that count as a conversion event for this objective.
  // Examples: 'purchase', 'lead', 'complete_registration', 'link_click'.
  conversionActionTypes: string[];

  // Subset of action types whose action_values sum into revenue. Usually
  // only purchase/transaction events have monetary value.
  revenueActionTypes: string[];
}

// Keyed by NORMALIZED objective (the value Nasaq Ads uses, not the raw Meta value).
// Unknown objectives fall back to META_CONVERSION_FALLBACK below.
export const DEFAULT_META_CONVERSION_MAP: Record<string, ConversionMapping> = {
  CONVERSIONS: {
    conversionActionTypes: [
      'purchase',
      'offsite_conversion.fb_pixel_purchase',
      'omni_purchase',
    ],
    revenueActionTypes: [
      'purchase',
      'offsite_conversion.fb_pixel_purchase',
      'omni_purchase',
    ],
  },
  LEADS: {
    conversionActionTypes: [
      'lead',
      'offsite_conversion.fb_pixel_lead',
      'complete_registration',
    ],
    revenueActionTypes: [], // leads have no revenue dimension
  },
  TRAFFIC: {
    conversionActionTypes: ['link_click', 'landing_page_view'],
    revenueActionTypes: [],
  },
  AWARENESS: {
    conversionActionTypes: [], // awareness is reach/impression-based, no conversions
    revenueActionTypes: [],
  },
  ENGAGEMENT: {
    conversionActionTypes: ['post_engagement', 'page_engagement'],
    revenueActionTypes: [],
  },
  APP_INSTALLS: {
    conversionActionTypes: ['mobile_app_install', 'app_install'],
    revenueActionTypes: ['mobile_app_install'],
  },
};

// Used when a metrics call comes through without an objective hint. Picks
// the union of common conversion events; biased toward not double-counting
// upstream events (e.g. excludes `link_click`).
export const META_CONVERSION_FALLBACK: ConversionMapping = {
  conversionActionTypes: [
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
    'lead',
    'complete_registration',
  ],
  revenueActionTypes: [
    'purchase',
    'offsite_conversion.fb_pixel_purchase',
  ],
};

// DI token. Injecting this (rather than importing the constant directly)
// lets us swap in an org-aware resolver later.
export const META_CONVERSION_MAP = 'META_CONVERSION_MAP';
