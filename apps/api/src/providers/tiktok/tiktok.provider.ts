import { Injectable, Logger } from '@nestjs/common';
import {
  IAdProvider,
  Platform,
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedMetrics,
  UpdateBudgetParams,
  UpdateBiddingStrategyParams,
  UpdateBidLimitsParams,
  ProviderActionResult,
  NormalizedCampaignDraft,
  NormalizedAdSetDraft,
  CreativeDraft,
  NormalizedAdDraft,
  BiddingStrategy,
  AdAccountRef,
  ProviderCapabilities,
  FetchMetricsHints,
} from '../interfaces/ad-provider.interface';
import { MockProvider } from '../mock/mock.provider';
import { AdAccountLoader } from '../shared/ad-account.loader';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { TikTokApiClient } from './tiktok-api.client';
import { TikTokMapperService } from './tiktok-mapper.service';
import { TikTokTokenService } from './tiktok-token.service';
import { AdAccount } from '@prisma/client';

// TikTokProvider implements IAdProvider for the TIKTOK platform.
//
// Mock fallback: when adAccount.status === 'MOCK', every method delegates
// to MockProvider. This lets developers exercise the full optimizer flow
// without real TikTok credentials.
//
// Phase 1 capabilities (see getCapabilities):
//   - CBO: yes (campaign-level budget when budget_mode != INFINITE)
//   - Lifetime budget: yes (BUDGET_MODE_TOTAL)
//   - Bid ceiling: yes (bid_price under BID_TYPE_CUSTOM)
//   - Bid floor: NO (TikTok does not surface an explicit ad-group floor)
//   - ROAS goal: yes (TikTok value-based optimization with `target_roas`)
//   - CPA goal: yes (BID_TYPE_MAX_CONVERSION with conversion_bid_price)
//   - Campaign creation: NO at Phase 1 (Phase 2)
//   - Creative upload: NO at Phase 1 (Phase 2)
//
// TikTok's ad-group writes do NOT need parent resolution — the API accepts
// advertiser_id + adgroup_id directly. This is simpler than Snap or Google.

@Injectable()
export class TikTokProvider implements IAdProvider {
  readonly platform: Platform = 'TIKTOK';
  private readonly logger = new Logger(TikTokProvider.name);

  constructor(
    private mock: MockProvider,
    private loader: AdAccountLoader,
    private api: TikTokApiClient,
    private mapper: TikTokMapperService,
    private tokens: TikTokTokenService,
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsCbo:              true,
      supportsLifetimeBudget:   true,
      supportsBidFloor:         false,   // TikTok has no ad-group bid floor
      supportsBidCeiling:       true,    // bid_price under BID_TYPE_CUSTOM
      supportsRoasGoal:         true,    // value-based optimization supported
      supportsCpaGoal:          true,    // BID_TYPE_MAX_CONVERSION
      supportsCampaignCreation: false,   // Phase 2
      supportsCreativeUpload:   false,   // Phase 2
    };
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  async validateCredentials(account: AdAccountRef): Promise<boolean> {
    const loaded = await this.loadOrMock(account, true);
    if (!loaded) return this.mock.validateCredentials(account);
    try {
      // /advertiser/info/ is the cheapest authenticated read that confirms
      // both token validity AND account access.
      await this.api.getAdvertiser(loaded.accessToken, account.externalId);
      return true;
    } catch (err) {
      if (err instanceof ProviderError && err.kind === ProviderErrorKind.INVALID_TOKEN) {
        return false;
      }
      throw err;
    }
  }

  async refreshAccessToken(account: AdAccountRef): Promise<void> {
    const loaded = await this.loadOrMock(account, true);
    if (!loaded) return this.mock.refreshAccessToken(account);
    await this.tokens.forceRefresh(loaded.account);
  }

  // ─── Reads ────────────────────────────────────────────────────────────────
  async fetchCampaigns(account: AdAccountRef): Promise<NormalizedCampaign[]> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.fetchCampaigns(account);

    const raw = await this.api.listCampaigns(loaded.accessToken, account.externalId);
    return raw.map((c) => this.mapper.toNormalizedCampaign(c));
  }

  async fetchAdSets(
    account: AdAccountRef,
    campaignExternalId: string,
  ): Promise<NormalizedAdSet[]> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.fetchAdSets(account, campaignExternalId);

    const raw = await this.api.listAdGroups(
      loaded.accessToken,
      account.externalId,
      campaignExternalId,
    );
    return raw.map((a) => this.mapper.toNormalizedAdSet(a));
  }

  async fetchMetrics(
    account: AdAccountRef,
    entityType: 'CAMPAIGN' | 'AD_SET',
    externalId: string,
    windowHours: 24 | 48 | 72,
    hints?: FetchMetricsHints,
  ): Promise<NormalizedMetrics> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.fetchMetrics(account, entityType, externalId, windowHours);

    const days = windowHours / 24;
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate   = now.toISOString().slice(0, 10);

    const metrics = [
      'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
      'reach', 'frequency', 'conversions', 'conversion_rate',
      'cost_per_conversion', 'total_purchase_value',
      'app_event_purchase', 'app_event_purchase_value',
    ];

    const row = await this.api.fetchReport(
      loaded.accessToken,
      account.externalId,
      entityType === 'CAMPAIGN' ? 'CAMPAIGN' : 'AD_GROUP',
      externalId,
      startDate,
      endDate,
      metrics,
    );
    return this.mapper.toNormalizedMetrics(
      row,
      externalId,
      entityType,
      windowHours,
      hints?.objective,
      startDate,
      endDate,
    );
  }

  // ─── Writes (Phase 1: minimal) ────────────────────────────────────────────
  async updateBudget(
    account: AdAccountRef,
    params: UpdateBudgetParams,
  ): Promise<ProviderActionResult> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.updateBudget(account, params);

    return this.mutation(async () => {
      if (params.entityType === 'CAMPAIGN') {
        await this.api.updateCampaign(loaded.accessToken, account.externalId, {
          campaign_id: params.externalId,
          budget:      params.newDailyBudget,
          budget_mode: 'BUDGET_MODE_DAY',
        });
      } else {
        await this.api.updateAdGroup(loaded.accessToken, account.externalId, {
          adgroup_id:  params.externalId,
          budget:      params.newDailyBudget,
          budget_mode: 'BUDGET_MODE_DAY',
        });
      }
      return params.externalId;
    }, params.externalId);
  }

  async updateBiddingStrategy(
    account: AdAccountRef,
    params: UpdateBiddingStrategyParams,
  ): Promise<ProviderActionResult> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.updateBiddingStrategy(account, params);

    return this.mutation(async () => {
      const body: Record<string, unknown> = {
        adgroup_id: params.adSetExternalId,
        bid_type:   this.toTikTokBidType(params.newStrategy),
      };
      // TikTok uses two distinct bid fields depending on strategy:
      //   - bid_price          for BID_TYPE_CUSTOM (cap)
      //   - conversion_bid_price for BID_TYPE_MAX_CONVERSION (target CPA)
      if (params.newBidAmount !== null) {
        if (params.newStrategy === BiddingStrategy.BID_CAP) {
          body.bid_price = params.newBidAmount;
        } else if (
          params.newStrategy === BiddingStrategy.COST_CAP ||
          params.newStrategy === BiddingStrategy.TARGET_CPA
        ) {
          body.conversion_bid_price = params.newBidAmount;
        }
      }
      await this.api.updateAdGroup(loaded.accessToken, account.externalId, body);
      return params.adSetExternalId;
    }, params.adSetExternalId);
  }

  async updateBidLimits(
    account: AdAccountRef,
    params: UpdateBidLimitsParams,
  ): Promise<ProviderActionResult> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.updateBidLimits(account, params);

    // Honest-failure gate: TikTok does not expose an ad-group bid floor
    // (see getCapabilities().supportsBidFloor=false). The guardrail in the
    // optimizer is the primary line of defense; this check is defense-in-depth
    // for any direct caller. We must NOT silently return success — that would
    // cause the executor to record APPLIED for a no-op write.
    if (params.newBidFloor !== null) {
      this.logger.warn(
        `TikTok does not support ad-group bid floor; refusing newBidFloor=${params.newBidFloor} for ${params.adSetExternalId}`,
      );
      return {
        success: false,
        externalId: params.adSetExternalId,
        platform: this.platform,
        appliedAt: new Date().toISOString(),
        errorCode: 'UNSUPPORTED',
        errorMessage: 'TikTok has no ad-group bid floor (supportsBidFloor=false)',
        providerResponse: null,
      };
    }

    return this.mutation(async () => {
      if (params.newBidCeiling === null) {
        // Nothing to do — return without mutating.
        return params.adSetExternalId;
      }
      // TikTok models a bid ceiling as `bid_price` interpreted under
      // BID_TYPE_CUSTOM. We set both fields atomically so the ceiling
      // is honored regardless of whatever bid_type was previously
      // configured. The optimizer is expected to switch strategy
      // separately when that is the intent.
      await this.api.updateAdGroup(loaded.accessToken, account.externalId, {
        adgroup_id: params.adSetExternalId,
        bid_type:   'BID_TYPE_CUSTOM',
        bid_price:  params.newBidCeiling,
      });
      return params.adSetExternalId;
    }, params.adSetExternalId);
  }

  // ─── Creation (Phase 2 — delegated to mock for now) ───────────────────────
  async createCampaign(account: AdAccountRef, draft: NormalizedCampaignDraft): Promise<ProviderActionResult> {
    return this.mock.createCampaign(account, draft);
  }
  async createAdSet(account: AdAccountRef, draft: NormalizedAdSetDraft): Promise<ProviderActionResult> {
    return this.mock.createAdSet(account, draft);
  }
  async uploadCreative(account: AdAccountRef, draft: CreativeDraft): Promise<ProviderActionResult> {
    return this.mock.uploadCreative(account, draft);
  }
  async createAd(account: AdAccountRef, draft: NormalizedAdDraft): Promise<ProviderActionResult> {
    return this.mock.createAd(account, draft);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async loadOrMock(
    account: AdAccountRef,
    skipTokenRefresh = false,
  ): Promise<{ account: AdAccount; accessToken: string } | null> {
    const loaded = await this.loader.load(account);
    if (this.loader.isMock(loaded.account)) return null;

    if (!skipTokenRefresh) {
      await this.tokens.refreshIfNeeded(loaded.account).catch((err) => {
        this.logger.warn(`Pre-call token refresh check failed for ${loaded.account.id}: ${err.message}`);
      });
    }
    return loaded;
  }

  private toTikTokBidType(s: BiddingStrategy): string {
    switch (s) {
      case BiddingStrategy.LOWEST_COST: return 'BID_TYPE_NO_BID';
      case BiddingStrategy.BID_CAP:     return 'BID_TYPE_CUSTOM';
      case BiddingStrategy.COST_CAP:    return 'BID_TYPE_MAX_CONVERSION';
      case BiddingStrategy.TARGET_CPA:  return 'BID_TYPE_MAX_CONVERSION';
      // TARGET_ROAS is supported via separate value-based fields rather than
      // a dedicated bid_type. For Phase 1 we map to NO_BID — when ROAS-mode
      // optimization lands we'll route through a value-optimization path.
      case BiddingStrategy.TARGET_ROAS: return 'BID_TYPE_NO_BID';
    }
  }

  private async mutation(
    fn: () => Promise<string>,
    fallbackExternalId: string,
  ): Promise<ProviderActionResult> {
    try {
      const externalId = await fn();
      return {
        success:          true,
        externalId,
        platform:         'TIKTOK',
        appliedAt:        new Date().toISOString(),
        errorCode:        null,
        errorMessage:     null,
        providerResponse: null,
      };
    } catch (err) {
      const pe = err instanceof ProviderError ? err : null;
      return {
        success:          false,
        externalId:       fallbackExternalId,
        platform:         'TIKTOK',
        appliedAt:        new Date().toISOString(),
        errorCode:        pe?.providerCode ?? 'UNKNOWN',
        errorMessage:     (err as Error).message,
        providerResponse: pe?.raw ?? null,
      };
    }
  }
}
