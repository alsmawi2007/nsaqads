// Conversion event mapping for TikTok. The TikTok report API exposes
// per-objective metric fields (`conversions`, `total_purchase_value`,
// `app_event_purchase`, etc.) rather than a flat actions array, so the
// mapping shape is similar to Snap's: per objective we declare which metric
// fields contribute to `conversions` and `revenue`.

export interface TikTokConversionMapping {
  conversionFields: ReadonlyArray<keyof TikTokConversionMetricFields>;
  revenueFields:    ReadonlyArray<keyof TikTokConversionMetricFields>;
}

// Subset of TikTok report fields that can contribute to conversion/revenue
// aggregation. Listed explicitly so the mapping can index a typed surface.
export interface TikTokConversionMetricFields {
  conversions?:                number | string;
  total_purchase_value?:       number | string;
  complete_payment_roas?:      number | string;
  app_event_purchase?:         number | string;
  app_event_purchase_value?:   number | string;
  clicks?:                     number | string;
  impressions?:                number | string;
  reach?:                      number | string;
}

// Keyed by NORMALIZED objective. Unknown objectives fall back to
// TIKTOK_CONVERSION_FALLBACK below.
export const DEFAULT_TIKTOK_CONVERSION_MAP: Record<string, TikTokConversionMapping> = {
  CONVERSIONS: {
    conversionFields: ['conversions'],
    revenueFields:    ['total_purchase_value'],
  },
  LEADS: {
    conversionFields: ['conversions'],
    revenueFields:    [],
  },
  TRAFFIC: {
    conversionFields: ['clicks'],
    revenueFields:    [],
  },
  AWARENESS: {
    conversionFields: [],
    revenueFields:    [],
  },
  ENGAGEMENT: {
    conversionFields: ['clicks'],
    revenueFields:    [],
  },
  APP_INSTALLS: {
    conversionFields: ['app_event_purchase', 'conversions'],
    revenueFields:    ['app_event_purchase_value'],
  },
  VIDEO_VIEWS: {
    conversionFields: [],
    revenueFields:    [],
  },
};

export const TIKTOK_CONVERSION_FALLBACK: TikTokConversionMapping = {
  conversionFields: ['conversions'],
  revenueFields:    ['total_purchase_value'],
};

// DI token. Injected (rather than imported) so an org-aware resolver can
// replace it later without touching the mapper.
export const TIKTOK_CONVERSION_MAP = 'TIKTOK_CONVERSION_MAP';
