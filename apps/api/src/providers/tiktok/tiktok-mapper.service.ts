import { Inject, Injectable } from '@nestjs/common';
import {
  BiddingStrategy,
  EntityStatus,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedMetrics,
} from '../interfaces/ad-provider.interface';
import {
  TIKTOK_OBJECTIVE_REVERSE,
  TIKTOK_STATUS_MAP,
} from './tiktok.constants';
import {
  TikTokAdGroup,
  TikTokCampaign,
  TikTokStatsRow,
} from './dto/tiktok-raw.types';
import {
  DEFAULT_TIKTOK_CONVERSION_MAP,
  TIKTOK_CONVERSION_FALLBACK,
  TIKTOK_CONVERSION_MAP,
  TikTokConversionMapping,
  TikTokConversionMetricFields,
} from './tiktok-conversion-config';

// Pure mapping layer. NO side effects, NO HTTP calls, NO database. Anything
// "from TikTok API" → "Nasaq Ads normalized type" goes through here.
//
// The conversion map is INJECTED rather than imported so it can later be
// replaced by an org-aware resolver that reads per-objective overrides
// from AdminSettings. Phase 1: single static map.

@Injectable()
export class TikTokMapperService {
  constructor(
    @Inject(TIKTOK_CONVERSION_MAP)
    private readonly conversionMap: Record<string, TikTokConversionMapping>,
  ) {}

  toNormalizedCampaign(c: TikTokCampaign): NormalizedCampaign {
    const objectiveRaw = c.objective_type ?? c.objective ?? '';
    const isLifetime   = c.budget_mode === 'BUDGET_MODE_TOTAL';
    const isInfinite   = c.budget_mode === 'BUDGET_MODE_INFINITE';
    const budget       = !isInfinite && typeof c.budget === 'number' ? c.budget : null;

    return {
      externalId:     c.campaign_id,
      name:           c.campaign_name,
      status:         this.mapStatus(c.operation_status, c.secondary_status),
      objective:      TIKTOK_OBJECTIVE_REVERSE[objectiveRaw] ?? objectiveRaw ?? 'UNKNOWN',
      dailyBudget:    !isLifetime && budget !== null ? budget : null,
      lifetimeBudget: isLifetime  && budget !== null ? budget : null,
      startDate:      this.toDateOnly(c.schedule_start_time),
      endDate:        this.toDateOnly(c.schedule_end_time),
      // TikTok CBO: campaign-level budget (BUDGET_MODE_DAY or _TOTAL with a
      // numeric budget) signals that the campaign is the budget owner. With
      // BUDGET_MODE_INFINITE budgets live on the ad groups.
      isCbo:          budget !== null,
    };
  }

  toNormalizedAdSet(a: TikTokAdGroup): NormalizedAdSet {
    const isLifetime = a.budget_mode === 'BUDGET_MODE_TOTAL';
    const dailyBudget =
      !isLifetime && typeof a.budget === 'number' && a.budget > 0
        ? a.budget
        : null;

    return {
      externalId:         a.adgroup_id,
      campaignExternalId: a.campaign_id,
      name:               a.adgroup_name,
      status:             this.mapStatus(a.operation_status, a.secondary_status),
      dailyBudget,
      biddingStrategy:    this.mapBidStrategy(a.bid_type),
      bidAmount:          a.bid_price ?? null,
      // TikTok exposes a single bid_price (cap) and a conversion_bid_price
      // (target). Neither is a true min/max pair; we surface the cap as the
      // ceiling when bid_type is custom and leave floor null.
      bidFloor:           null,
      bidCeiling:         a.bid_type === 'BID_TYPE_CUSTOM' ? a.bid_price ?? null : null,
    };
  }

  toNormalizedMetrics(
    row: TikTokStatsRow | null,
    externalId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    windowHours: 24 | 48 | 72,
    objective?: string,
    dateStart?: string,
    dateEnd?: string,
  ): NormalizedMetrics {
    const mapping = (objective && this.conversionMap[objective])
      ? this.conversionMap[objective]
      : TIKTOK_CONVERSION_FALLBACK;

    const r = row ?? ({} as TikTokStatsRow);
    const spend       = this.numFloat(r.spend);
    const impressions = this.numInt(r.impressions);
    const clicks      = this.numInt(r.clicks);
    const reach       = this.numInt(r.reach);
    const frequency   = this.numFloat(r.frequency);
    const conversions = this.extractConversions(r as TikTokConversionMetricFields, mapping);
    const revenue     = this.extractRevenue(r as TikTokConversionMetricFields, mapping);

    const ctr  = impressions > 0 ? clicks / impressions : 0;
    const cpc  = clicks > 0 ? spend / clicks : 0;
    const cpa  = conversions > 0 ? spend / conversions : 0;
    const roas = spend > 0 ? revenue / spend : 0;

    return {
      externalId,
      entityType,
      windowHours,
      dateStart:   dateStart ?? '',
      dateEnd:     dateEnd ?? dateStart ?? '',
      spend:       round(spend),
      impressions,
      clicks,
      ctr:         round(ctr, 6),
      cpc:         round(cpc),
      conversions,
      cpa:         round(cpa),
      revenue:     round(revenue),
      roas:        round(roas, 4),
      reach,
      frequency:   round(frequency, 4),
      spendPacing: 1,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private mapStatus(op?: string, secondary?: string): EntityStatus {
    if (op && TIKTOK_STATUS_MAP[op]) return TIKTOK_STATUS_MAP[op];
    if (secondary && TIKTOK_STATUS_MAP[secondary]) return TIKTOK_STATUS_MAP[secondary];
    return 'PAUSED';
  }

  private mapBidStrategy(s: string | undefined): BiddingStrategy {
    switch (s) {
      case 'BID_TYPE_NO_BID':           return BiddingStrategy.LOWEST_COST;
      case 'BID_TYPE_CUSTOM':           return BiddingStrategy.BID_CAP;
      case 'BID_TYPE_MAX_CONVERSION':   return BiddingStrategy.TARGET_CPA;
      default:                          return BiddingStrategy.LOWEST_COST;
    }
  }

  private toDateOnly(iso: string | undefined): string | null {
    if (!iso) return null;
    // TikTok schedule_start_time is "YYYY-MM-DD HH:mm:ss" or ISO. Take 10.
    return iso.slice(0, 10);
  }

  private numInt(n: number | string | undefined): number {
    if (n === undefined || n === null || n === '') return 0;
    const v = typeof n === 'string' ? parseFloat(n) : n;
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  }

  private numFloat(n: number | string | undefined): number {
    if (n === undefined || n === null || n === '') return 0;
    const v = typeof n === 'string' ? parseFloat(n) : n;
    return Number.isFinite(v) ? v : 0;
  }

  private extractConversions(
    r: TikTokConversionMetricFields,
    mapping: TikTokConversionMapping,
  ): number {
    return mapping.conversionFields.reduce(
      (s, k) => s + this.numFloat(r[k]),
      0,
    );
  }

  private extractRevenue(
    r: TikTokConversionMetricFields,
    mapping: TikTokConversionMapping,
  ): number {
    return mapping.revenueFields.reduce(
      (s, k) => s + this.numFloat(r[k]),
      0,
    );
  }
}

function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

// Re-exported here so callers can pull both the service and the default map
// from the same import path when wiring DI.
export { DEFAULT_TIKTOK_CONVERSION_MAP };
