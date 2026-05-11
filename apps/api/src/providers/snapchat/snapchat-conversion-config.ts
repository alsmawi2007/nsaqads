// Conversion event mapping for Snapchat. Snap exposes conversion metrics
// as discrete fields (`conversion_purchases`, `conversion_sign_ups`,
// `conversion_purchases_value`, etc.) rather than a flat `actions` array,
// so the mapping shape here is simpler than Meta's: per objective we
// declare which metric fields contribute to `conversions` and `revenue`.

export interface SnapConversionMapping {
  // Stats fields whose values sum into the `conversions` count.
  conversionFields: ReadonlyArray<keyof SnapConversionMetricFields>;

  // Stats fields whose values sum into the `revenue` total. Usually only
  // purchase-value fields. Values arrive as MICROS — the mapper divides.
  revenueFields:    ReadonlyArray<keyof SnapConversionMetricFields>;
}

// Subset of SnapStats fields that can contribute to conversion/revenue
// aggregation. Listed explicitly so the mapping can index a typed surface.
export interface SnapConversionMetricFields {
  conversions?:                    number;
  conversion_purchases?:           number;
  conversion_purchases_value?:     number;
  conversion_purchase_value_micro?: number;
  conversion_sign_ups?:            number;
  swipes?:                         number;
  impressions?:                    number;
}

// Keyed by NORMALIZED objective. Unknown objectives fall back to
// SNAP_CONVERSION_FALLBACK below.
export const DEFAULT_SNAP_CONVERSION_MAP: Record<string, SnapConversionMapping> = {
  CONVERSIONS: {
    conversionFields: ['conversion_purchases', 'conversions'],
    revenueFields:    ['conversion_purchase_value_micro', 'conversion_purchases_value'],
  },
  LEADS: {
    conversionFields: ['conversion_sign_ups', 'conversions'],
    revenueFields:    [],
  },
  TRAFFIC: {
    conversionFields: ['swipes'],
    revenueFields:    [],
  },
  AWARENESS: {
    conversionFields: [],
    revenueFields:    [],
  },
  ENGAGEMENT: {
    conversionFields: ['swipes'],
    revenueFields:    [],
  },
  APP_INSTALLS: {
    conversionFields: ['conversions'],
    revenueFields:    [],
  },
};

export const SNAP_CONVERSION_FALLBACK: SnapConversionMapping = {
  conversionFields: ['conversion_purchases', 'conversions'],
  revenueFields:    ['conversion_purchase_value_micro', 'conversion_purchases_value'],
};

// DI token. Injected (rather than imported) so an org-aware resolver can
// replace it later without touching the mapper.
export const SNAP_CONVERSION_MAP = 'SNAP_CONVERSION_MAP';
