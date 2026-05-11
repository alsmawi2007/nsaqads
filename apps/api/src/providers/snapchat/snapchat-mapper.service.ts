import { Inject, Injectable } from '@nestjs/common';
import {
  BiddingStrategy,
  EntityStatus,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedMetrics,
} from '../interfaces/ad-provider.interface';
import {
  SNAP_OBJECTIVE_REVERSE,
  SNAP_STATUS_MAP,
  microsToMajor,
} from './snapchat.constants';
import {
  SnapAdSquad,
  SnapCampaign,
  SnapStats,
  SnapStatsRow,
} from './dto/snapchat-raw.types';
import {
  DEFAULT_SNAP_CONVERSION_MAP,
  SNAP_CONVERSION_FALLBACK,
  SNAP_CONVERSION_MAP,
  SnapConversionMapping,
  SnapConversionMetricFields,
} from './snapchat-conversion-config';

// Pure mapping layer. NO side effects, NO HTTP calls, NO database. Anything
// "from Snapchat API" → "Nasaq Ads normalized type" goes through here.
//
// The conversion map is INJECTED rather than imported so it can later be
// replaced by an org-aware resolver that reads per-objective overrides
// from AdminSettings. Phase 1: single static map.

@Injectable()
export class SnapchatMapperService {
  constructor(
    @Inject(SNAP_CONVERSION_MAP)
    private readonly conversionMap: Record<string, SnapConversionMapping>,
  ) {}

  toNormalizedCampaign(c: SnapCampaign): NormalizedCampaign {
    const dailyBudget = microsToMajor(c.daily_budget_micro ?? null);
    const lifetimeBudget = microsToMajor(c.lifetime_spend_cap_micro ?? null);
    const objectiveRaw = c.objective_v2 ?? c.objective ?? '';
    return {
      externalId:     c.id,
      name:           c.name,
      status:         this.mapStatus(c.status),
      objective:      SNAP_OBJECTIVE_REVERSE[objectiveRaw] ?? objectiveRaw ?? 'UNKNOWN',
      dailyBudget,
      lifetimeBudget,
      startDate:      this.toDateOnly(c.start_time),
      endDate:        this.toDateOnly(c.end_time),
      // Snap CBO: a campaign-level daily/lifetime budget signals CBO.
      // Without one, budgets live on each ad squad.
      isCbo:          dailyBudget !== null || lifetimeBudget !== null,
    };
  }

  toNormalizedAdSet(a: SnapAdSquad): NormalizedAdSet {
    return {
      externalId:         a.id,
      campaignExternalId: a.campaign_id,
      name:               a.name,
      status:             this.mapStatus(a.status),
      dailyBudget:        microsToMajor(a.daily_budget_micro ?? null),
      biddingStrategy:    this.mapBidStrategy(a.bid_strategy),
      bidAmount:          microsToMajor(a.bid_micro ?? null),
      // Snap exposes a single `bid_micro` interpreted as a cap (MAX_BID) or
      // a target (TARGET_COST) depending on bid_strategy. There is no
      // separate floor/ceiling pair surfaced on ad squads.
      bidFloor:           null,
      bidCeiling:         null,
    };
  }

  toNormalizedMetrics(
    stats: SnapStats | null,
    externalId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    windowHours: 24 | 48 | 72,
    objective?: string,
  ): NormalizedMetrics {
    const mapping = (objective && this.conversionMap[objective])
      ? this.conversionMap[objective]
      : SNAP_CONVERSION_FALLBACK;

    // Snap returns a flat TOTAL row OR a `timeseries` array when granularity
    // is DAY. We aggregate either shape into a single normalized row.
    const rows: SnapStatsRow[] = stats?.timeseries?.length
      ? stats.timeseries
      : stats
        ? [stats as SnapStatsRow]
        : [];

    interface Totals {
      spend: number; impressions: number; clicks: number; uniques: number;
      frequency: number; conversions: number; revenue: number;
    }
    const totals = rows.reduce<Totals>(
      (acc, r) => {
        acc.spend       += microsToMajor(r.spend ?? null) ?? 0;
        acc.impressions += this.numInt(r.impressions);
        acc.clicks      += this.numInt(r.swipes);
        acc.uniques     += this.numInt(r.uniques);
        acc.frequency   += r.frequency ?? 0;
        acc.conversions += this.extractConversions(r, mapping);
        acc.revenue     += this.extractRevenue(r, mapping);
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, uniques: 0, frequency: 0, conversions: 0, revenue: 0 },
    );

    const dateStart = stats?.start_time?.slice(0, 10) ?? '';
    const dateEnd   = stats?.end_time?.slice(0, 10) ?? dateStart;
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
      reach:       totals.uniques,
      frequency:   round(frequency, 4),
      spendPacing: 1,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private mapStatus(s: string): EntityStatus {
    return SNAP_STATUS_MAP[s] ?? 'PAUSED';
  }

  private mapBidStrategy(s: string | undefined): BiddingStrategy {
    switch (s) {
      case 'AUTO_BID':                  return BiddingStrategy.LOWEST_COST;
      case 'LOWEST_COST_WITH_MAX_BID':  return BiddingStrategy.BID_CAP;
      case 'MAX_BID':                   return BiddingStrategy.BID_CAP;
      case 'TARGET_COST':               return BiddingStrategy.TARGET_CPA;
      default:                          return BiddingStrategy.LOWEST_COST;
    }
  }

  private toDateOnly(iso: string | undefined): string | null {
    if (!iso) return null;
    return iso.slice(0, 10);
  }

  private numInt(n: number | undefined): number {
    if (n === undefined || n === null) return 0;
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  private extractConversions(
    r: SnapConversionMetricFields,
    mapping: SnapConversionMapping,
  ): number {
    return mapping.conversionFields.reduce(
      (s, k) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0),
      0,
    );
  }

  private extractRevenue(
    r: SnapConversionMetricFields,
    mapping: SnapConversionMapping,
  ): number {
    return mapping.revenueFields.reduce((s, k) => {
      const v = r[k];
      if (typeof v !== 'number') return s;
      // Revenue values arrive as MICROS when the field name ends in `_micro`;
      // older `conversion_purchases_value` is already in major units.
      const isMicro = String(k).endsWith('_micro');
      return s + (isMicro ? v / 1_000_000 : v);
    }, 0);
  }
}

function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

// Re-exported here so callers can pull both the service and the default map
// from the same import path when wiring DI.
export { DEFAULT_SNAP_CONVERSION_MAP };
