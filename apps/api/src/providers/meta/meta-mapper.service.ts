import { Inject, Injectable } from '@nestjs/common';
import {
  BiddingStrategy,
  EntityStatus,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedMetrics,
} from '../interfaces/ad-provider.interface';
import {
  META_OBJECTIVE_REVERSE,
  META_STATUS_MAP,
  minorToMajor,
} from './meta.constants';
import {
  MetaAdSet,
  MetaCampaign,
  MetaInsightsRow,
} from './dto/meta-raw.types';
import {
  ConversionMapping,
  DEFAULT_META_CONVERSION_MAP,
  META_CONVERSION_FALLBACK,
  META_CONVERSION_MAP,
} from './meta-conversion-config';

// Pure mapping layer. NO side effects, NO HTTP calls, NO database. Anything
// "from Meta API" → "Nasaq Ads normalized type" goes through here. Easy to unit
// test in isolation; deterministic.
//
// The conversion map is INJECTED rather than imported as a constant so it
// can later be replaced by an org-aware resolver that reads per-objective
// overrides from AdminSettings. Phase 1: single static map.

@Injectable()
export class MetaMapperService {
  constructor(
    @Inject(META_CONVERSION_MAP)
    private readonly conversionMap: Record<string, ConversionMapping>,
  ) {}

  toNormalizedCampaign(c: MetaCampaign): NormalizedCampaign {
    return {
      externalId:     c.id,
      name:           c.name,
      status:         this.mapStatus(c.status),
      objective:      META_OBJECTIVE_REVERSE[c.objective ?? ''] ?? c.objective ?? 'UNKNOWN',
      dailyBudget:    minorToMajor(c.daily_budget),
      lifetimeBudget: minorToMajor(c.lifetime_budget),
      startDate:      this.toDateOnly(c.start_time),
      endDate:        this.toDateOnly(c.stop_time),
      // Meta CBO is detected by whether the budget lives at campaign level.
      isCbo:          Boolean(c.daily_budget || c.lifetime_budget),
    };
  }

  toNormalizedAdSet(a: MetaAdSet): NormalizedAdSet {
    return {
      externalId:         a.id,
      campaignExternalId: a.campaign_id,
      name:               a.name,
      status:             this.mapStatus(a.status),
      dailyBudget:        minorToMajor(a.daily_budget),
      biddingStrategy:    this.mapBidStrategy(a.bid_strategy),
      bidAmount:          minorToMajor(a.bid_amount),
      // Meta does not expose hard floor/ceiling on ad sets; left as null.
      bidFloor:           null,
      bidCeiling:         null,
    };
  }

  toNormalizedMetrics(
    rows: MetaInsightsRow[],
    externalId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    windowHours: 24 | 48 | 72,
    objective?: string,
  ): NormalizedMetrics {
    // Pick the conversion mapping for the campaign's objective when known;
    // fall back to the union of common types when not.
    const mapping = (objective && this.conversionMap[objective])
      ? this.conversionMap[objective]
      : META_CONVERSION_FALLBACK;
    const conversionTypes = new Set(mapping.conversionActionTypes);
    const revenueTypes    = new Set(mapping.revenueActionTypes);

    // Aggregate the rolling window. Insights API returns per-day rows when
    // we ask for time_increment=1; we collapse them into one normalized row.
    const totals = rows.reduce(
      (acc, r) => {
        acc.spend       += this.num(r.spend);
        acc.impressions += this.numInt(r.impressions);
        acc.clicks      += this.numInt(r.clicks);
        acc.reach       += this.numInt(r.reach);
        acc.frequency   += this.num(r.frequency);
        acc.conversions += this.extractConversions(r, conversionTypes);
        acc.revenue     += this.extractRevenue(r, revenueTypes);
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, reach: 0, frequency: 0, conversions: 0, revenue: 0 },
    );

    const dateStart = rows[0]?.date_start ?? '';
    const dateEnd   = rows[rows.length - 1]?.date_stop ?? dateStart;
    const ctr       = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    const cpc       = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const cpa       = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
    const roas      = totals.spend > 0 ? totals.revenue / totals.spend : 0;
    const frequency = rows.length > 0 ? totals.frequency / rows.length : 0;

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
      conversions: totals.conversions,
      cpa:         round(cpa),
      revenue:     round(totals.revenue),
      roas:        round(roas, 4),
      reach:       totals.reach,
      frequency:   round(frequency, 4),
      spendPacing: 1,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private mapStatus(s: string): EntityStatus {
    return META_STATUS_MAP[s] ?? 'PAUSED';
  }

  private mapBidStrategy(s: string | undefined): BiddingStrategy {
    switch (s) {
      case 'LOWEST_COST_WITHOUT_CAP':       return BiddingStrategy.LOWEST_COST;
      case 'LOWEST_COST_WITH_BID_CAP':      return BiddingStrategy.BID_CAP;
      case 'COST_CAP':                       return BiddingStrategy.COST_CAP;
      case 'TARGET_COST':                    return BiddingStrategy.TARGET_CPA;
      case 'LOWEST_COST_WITH_MIN_ROAS':     return BiddingStrategy.TARGET_ROAS;
      default:                               return BiddingStrategy.LOWEST_COST;
    }
  }

  private toDateOnly(iso: string | undefined): string | null {
    if (!iso) return null;
    return iso.slice(0, 10);
  }

  private num(s: string | undefined): number {
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  }

  private numInt(s: string | undefined): number {
    if (!s) return 0;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  private extractConversions(r: MetaInsightsRow, types: Set<string>): number {
    if (!r.actions || types.size === 0) return 0;
    return r.actions
      .filter((a) => types.has(a.action_type))
      .reduce((s, a) => s + this.num(a.value), 0);
  }

  private extractRevenue(r: MetaInsightsRow, types: Set<string>): number {
    if (!r.action_values || types.size === 0) return 0;
    return r.action_values
      .filter((a) => types.has(a.action_type))
      .reduce((s, a) => s + this.num(a.value), 0);
  }
}

function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

// Re-exported here so callers can pull both the service and the default map
// from the same import path when wiring DI.
export { DEFAULT_META_CONVERSION_MAP };
