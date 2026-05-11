import { Inject, Injectable } from '@nestjs/common';
import {
  BiddingStrategy,
  EntityStatus,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedMetrics,
} from '../interfaces/ad-provider.interface';
import {
  GOOGLE_OBJECTIVE_REVERSE,
  GOOGLE_STATUS_MAP,
  microsToMajor,
} from './google-ads.constants';
import {
  GoogleAdsAdGroupFields,
  GoogleAdsCampaignFields,
  GoogleAdsCampaignBudgetFields,
  GoogleAdsMetricsFields,
  GoogleAdsSearchRow,
} from './dto/google-ads-raw.types';
import {
  DEFAULT_GOOGLE_ADS_CONVERSION_MAP,
  GOOGLE_ADS_CONVERSION_FALLBACK,
  GOOGLE_ADS_CONVERSION_MAP,
  GoogleAdsConversionMapping,
} from './google-ads-conversion-config';

// Pure mapping layer. NO side effects, NO HTTP calls, NO database. Anything
// "from Google Ads API" → "Nasaq Ads normalized type" goes through here. Easy to
// unit test in isolation; deterministic.
//
// The conversion map is INJECTED rather than imported as a constant so it
// can later be replaced by an org-aware resolver that reads per-objective
// overrides from AdminSettings. Phase 1: single static map.

@Injectable()
export class GoogleAdsMapperService {
  constructor(
    @Inject(GOOGLE_ADS_CONVERSION_MAP)
    private readonly conversionMap: Record<string, GoogleAdsConversionMapping>,
  ) {}

  // Google Ads search responses bind campaign + campaign_budget into the same
  // row; the campaign row carries `campaign.campaignBudget` resource name and
  // (when the GAQL SELECT includes it) campaign_budget.amountMicros.
  toNormalizedCampaign(
    c: GoogleAdsCampaignFields,
    budget?: GoogleAdsCampaignBudgetFields,
  ): NormalizedCampaign {
    return {
      externalId:     c.id ?? '',
      name:           c.name ?? '',
      status:         this.mapStatus(c.status),
      objective:      GOOGLE_OBJECTIVE_REVERSE[c.advertisingChannelType ?? ''] ?? 'UNKNOWN',
      dailyBudget:    microsToMajor(budget?.amountMicros),
      // Google Ads campaign budgets are daily; lifetime budget isn't a native
      // concept for non-finite-period campaigns. totalAmountMicros only
      // applies to CUSTOM_PERIOD shared budgets and is rare in our path.
      lifetimeBudget: budget?.period === 'CUSTOM_PERIOD'
        ? microsToMajor(budget?.totalAmountMicros)
        : null,
      startDate:      this.toDateOnly(c.startDate),
      endDate:        this.toDateOnly(c.endDate),
      // Google Ads ALWAYS owns the budget at the campaign level (ad groups
      // do not have their own budgets). Treat every campaign as "CBO".
      isCbo:          true,
    };
  }

  toNormalizedAdSet(
    a: GoogleAdsAdGroupFields,
    campaignExternalId: string,
  ): NormalizedAdSet {
    return {
      externalId:         a.id ?? '',
      campaignExternalId,
      name:               a.name ?? '',
      status:             this.mapStatus(a.status),
      // Ad groups have no own budget in Google Ads.
      dailyBudget:        null,
      // Bidding strategy is configured at the campaign level in Google Ads,
      // but the IAdProvider contract surfaces it on the ad set. We mirror
      // the campaign-level value into each ad set during sync.
      biddingStrategy:    BiddingStrategy.LOWEST_COST,
      bidAmount:          microsToMajor(a.cpcBidMicros),
      // Google Ads exposes cpc bid floor/ceiling on TARGET_CPA / TARGET_ROAS
      // bidding strategies, but those are campaign-level — the ad set layer
      // doesn't carry them in the same shape Meta does. Left null and
      // surfaced via capabilities (supportsBidFloor=false, supportsBidCeiling=true).
      bidFloor:           null,
      bidCeiling:         null,
    };
  }

  // Helper: normalize a campaign-level bidding strategy when it is exposed
  // via the campaign row. Returns null if absent.
  mapCampaignBidStrategy(c: GoogleAdsCampaignFields): BiddingStrategy {
    switch (c.biddingStrategyType) {
      case 'MAXIMIZE_CONVERSIONS':       return BiddingStrategy.LOWEST_COST;
      case 'MAXIMIZE_CONVERSION_VALUE':  return BiddingStrategy.LOWEST_COST;
      case 'MANUAL_CPC':                 return BiddingStrategy.BID_CAP;
      case 'TARGET_CPA':                 return BiddingStrategy.TARGET_CPA;
      case 'TARGET_ROAS':                return BiddingStrategy.TARGET_ROAS;
      case 'TARGET_SPEND':               return BiddingStrategy.LOWEST_COST;
      case 'TARGET_IMPRESSION_SHARE':    return BiddingStrategy.LOWEST_COST;
      default:                            return BiddingStrategy.LOWEST_COST;
    }
  }

  toNormalizedMetrics(
    rows: GoogleAdsSearchRow[],
    externalId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    windowHours: 24 | 48 | 72,
    objective?: string,
  ): NormalizedMetrics {
    const mapping = (objective && this.conversionMap[objective])
      ? this.conversionMap[objective]
      : GOOGLE_ADS_CONVERSION_FALLBACK;

    const totals = rows.reduce(
      (acc, r) => {
        const m: GoogleAdsMetricsFields = r.metrics ?? {};
        acc.spend       += this.numFromMicros(m.costMicros);
        acc.impressions += this.numInt(m.impressions);
        acc.clicks      += this.numInt(m.clicks);
        acc.conversions += mapping.useAggregatedConversions ? this.num(m.conversions) : 0;
        acc.revenue     += mapping.useConversionValue       ? this.num(m.conversionsValue) : 0;
        // Google Ads does not return reach/frequency from googleAds:search.
        // Reach data lives in the Reach Planning API (separate service);
        // we leave it 0 in Phase 1 and document the gap on capabilities.
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
    );

    const dates = rows
      .map((r) => r.segments?.date)
      .filter((d): d is string => typeof d === 'string')
      .sort();
    const dateStart = dates[0] ?? '';
    const dateEnd   = dates[dates.length - 1] ?? dateStart;

    const ctr  = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    const cpc  = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const cpa  = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
    const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

    return {
      externalId,
      entityType,
      windowHours,
      dateStart,
      dateEnd,
      spend:       round(totals.spend),
      impressions: totals.impressions,
      clicks:      totals.clicks,
      ctr:         round(ctr, 6),
      cpc:         round(cpc),
      conversions: Math.round(totals.conversions),
      cpa:         round(cpa),
      revenue:     round(totals.revenue),
      roas:        round(roas, 4),
      // Google Ads search API does not return reach/frequency.
      reach:       0,
      frequency:   0,
      spendPacing: 1,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private mapStatus(s: string | undefined): EntityStatus {
    if (!s) return 'PAUSED';
    return GOOGLE_STATUS_MAP[s] ?? 'PAUSED';
  }

  private toDateOnly(iso: string | undefined): string | null {
    if (!iso) return null;
    // Google Ads sometimes returns YYYY-MM-DD, sometimes YYYYMMDD.
    if (/^\d{8}$/.test(iso)) {
      return `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}`;
    }
    return iso.slice(0, 10);
  }

  private num(s: number | string | undefined): number {
    if (s === undefined || s === null || s === '') return 0;
    const n = typeof s === 'string' ? parseFloat(s) : s;
    return Number.isNaN(n) ? 0 : n;
  }

  private numInt(s: number | string | undefined): number {
    if (s === undefined || s === null || s === '') return 0;
    const n = typeof s === 'string' ? parseInt(s, 10) : Math.trunc(s);
    return Number.isNaN(n) ? 0 : n;
  }

  private numFromMicros(s: string | undefined): number {
    return this.num(s) / 1_000_000;
  }
}

function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

export { DEFAULT_GOOGLE_ADS_CONVERSION_MAP };
