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
import { SnapchatApiClient } from './snapchat-api.client';
import { SnapchatMapperService } from './snapchat-mapper.service';
import { SnapchatTokenService } from './snapchat-token.service';
import { majorToMicros } from './snapchat.constants';
import { AdAccount } from '@prisma/client';

// SnapchatProvider implements IAdProvider for the SNAPCHAT platform.
//
// Mock fallback: when adAccount.status === 'MOCK', every method delegates
// to MockProvider. This lets developers exercise the full optimizer flow
// without real Snap credentials.
//
// Phase 1 capabilities (see getCapabilities):
//   - CBO: yes (campaign-level daily/lifetime budgets supported)
//   - Lifetime budget: yes (lifetime_spend_cap_micro at campaign level)
//   - Bid ceiling: yes (bid_micro under MAX_BID / LOWEST_COST_WITH_MAX_BID)
//   - Bid floor: NO (Snap does not surface an explicit ad-squad floor)
//   - ROAS goal: NO (Snap exposes purchase-value metrics but no native
//                    TARGET_ROAS bid strategy at the ad-squad level)
//   - CPA goal: yes (TARGET_COST bid strategy)
//   - Campaign creation: NO at Phase 1 (Phase 2)
//   - Creative upload: NO at Phase 1 (Phase 2)

@Injectable()
export class SnapchatProvider implements IAdProvider {
  readonly platform: Platform = 'SNAPCHAT';
  private readonly logger = new Logger(SnapchatProvider.name);

  constructor(
    private mock: MockProvider,
    private loader: AdAccountLoader,
    private api: SnapchatApiClient,
    private mapper: SnapchatMapperService,
    private tokens: SnapchatTokenService,
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsCbo:              true,
      supportsLifetimeBudget:   true,
      supportsBidFloor:         false,   // Snap has no ad-squad bid floor
      supportsBidCeiling:       true,    // bid_micro under MAX_BID strategies
      supportsRoasGoal:         false,   // no native TARGET_ROAS at ad squad
      supportsCpaGoal:          true,
      supportsCampaignCreation: false,   // Phase 2
      supportsCreativeUpload:   false,   // Phase 2
    };
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  async validateCredentials(account: AdAccountRef): Promise<boolean> {
    const loaded = await this.loadOrMock(account, true);
    if (!loaded) return this.mock.validateCredentials(account);
    try {
      await this.api.get<{ me?: unknown }>('/me', loaded.accessToken);
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

    const raw = await this.api.listAdSquads(
      loaded.accessToken,
      campaignExternalId,
      account.externalId,
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

    const fields = [
      'spend', 'impressions', 'swipes', 'uniques', 'frequency',
      'conversion_purchases', 'conversion_purchases_value',
      'conversion_purchase_value_micro', 'conversion_sign_ups', 'conversions',
    ];

    const stats = await this.api.fetchStats(
      loaded.accessToken,
      entityType === 'CAMPAIGN' ? 'campaigns' : 'adsquads',
      externalId,
      start.toISOString(),
      now.toISOString(),
      fields,
      account.externalId,
    );
    return this.mapper.toNormalizedMetrics(
      stats,
      externalId,
      entityType,
      windowHours,
      hints?.objective,
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
      const dailyBudgetMicro = majorToMicros(params.newDailyBudget);
      if (params.entityType === 'CAMPAIGN') {
        await this.api.updateCampaign(
          loaded.accessToken,
          account.externalId,
          { id: params.externalId, daily_budget_micro: dailyBudgetMicro },
        );
      } else {
        // Snap ad-squad updates require the parent campaign id in the URL
        // path. Resolve it with a single GET before issuing the PUT — same
        // pattern used by the Google Ads adapter for ad-group → campaign
        // bid ceilings.
        const campaignId = await this.resolveCampaignFromAdSquad(
          loaded.accessToken,
          params.externalId,
          account.externalId,
        );
        await this.api.updateAdSquad(
          loaded.accessToken,
          campaignId,
          { id: params.externalId, daily_budget_micro: dailyBudgetMicro },
          account.externalId,
        );
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
      const campaignId = await this.resolveCampaignFromAdSquad(
        loaded.accessToken,
        params.adSetExternalId,
        account.externalId,
      );
      const body: Record<string, unknown> = {
        id:           params.adSetExternalId,
        bid_strategy: this.toSnapBidStrategy(params.newStrategy),
      };
      if (params.newBidAmount !== null) {
        body.bid_micro = majorToMicros(params.newBidAmount);
      }
      await this.api.updateAdSquad(
        loaded.accessToken,
        campaignId,
        body,
        account.externalId,
      );
      return params.adSetExternalId;
    }, params.adSetExternalId);
  }

  async updateBidLimits(
    account: AdAccountRef,
    params: UpdateBidLimitsParams,
  ): Promise<ProviderActionResult> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.updateBidLimits(account, params);

    // Honest-failure gate: Snapchat does not expose an ad-squad bid floor
    // (see getCapabilities().supportsBidFloor=false). The guardrail in the
    // optimizer is the primary line of defense; this check is defense-in-depth
    // for any direct caller. We must NOT silently return success — that would
    // cause the executor to record APPLIED for a no-op write.
    if (params.newBidFloor !== null) {
      this.logger.warn(
        `Snapchat does not support ad-squad bid floor; refusing newBidFloor=${params.newBidFloor} for ${params.adSetExternalId}`,
      );
      return {
        success: false,
        externalId: params.adSetExternalId,
        platform: this.platform,
        appliedAt: new Date().toISOString(),
        errorCode: 'UNSUPPORTED',
        errorMessage: 'Snapchat has no ad-squad bid floor (supportsBidFloor=false)',
        providerResponse: null,
      };
    }

    return this.mutation(async () => {
      if (params.newBidCeiling === null) {
        // Nothing to do — return without mutating.
        return params.adSetExternalId;
      }
      const campaignId = await this.resolveCampaignFromAdSquad(
        loaded.accessToken,
        params.adSetExternalId,
        account.externalId,
      );
      // Snap models a bid ceiling as `bid_micro` interpreted under
      // LOWEST_COST_WITH_MAX_BID. We set both fields atomically so the
      // ceiling is honored regardless of whatever strategy was previously
      // configured. The optimizer is expected to switch strategy separately
      // when that is the intent.
      await this.api.updateAdSquad(
        loaded.accessToken,
        campaignId,
        {
          id:           params.adSetExternalId,
          bid_strategy: 'LOWEST_COST_WITH_MAX_BID',
          bid_micro:    majorToMicros(params.newBidCeiling),
        },
        account.externalId,
      );
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

  // Snap write paths are parent-scoped (`/campaigns/{id}/adsquads`), so
  // ad-squad updates need the parent campaign id. We resolve it with a
  // single GET — the alternative (carrying it on the params interface)
  // would require changes to the platform-agnostic IAdProvider contract.
  private async resolveCampaignFromAdSquad(
    accessToken: string,
    adSquadExternalId: string,
    rateLimitExternalId: string,
  ): Promise<string> {
    const adSquad = await this.api.getAdSquad(
      accessToken,
      adSquadExternalId,
      rateLimitExternalId,
    );
    if (!adSquad?.campaign_id) {
      throw new ProviderError(
        ProviderErrorKind.NOT_FOUND,
        'SNAPCHAT',
        `Ad squad ${adSquadExternalId} not found or has no campaign_id`,
      );
    }
    return adSquad.campaign_id;
  }

  private toSnapBidStrategy(s: BiddingStrategy): string {
    switch (s) {
      case BiddingStrategy.LOWEST_COST: return 'AUTO_BID';
      case BiddingStrategy.BID_CAP:     return 'LOWEST_COST_WITH_MAX_BID';
      case BiddingStrategy.COST_CAP:    return 'TARGET_COST';
      case BiddingStrategy.TARGET_CPA:  return 'TARGET_COST';
      // TARGET_ROAS is gated by the optimizer guardrail (supportsRoasGoal=false)
      // and should not reach this method. Map to AUTO_BID as a safe default
      // if it ever does (executor will record APPLIED for an honest write).
      case BiddingStrategy.TARGET_ROAS: return 'AUTO_BID';
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
        platform:         'SNAPCHAT',
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
        platform:         'SNAPCHAT',
        appliedAt:        new Date().toISOString(),
        errorCode:        pe?.providerCode ?? 'UNKNOWN',
        errorMessage:     (err as Error).message,
        providerResponse: pe?.raw ?? null,
      };
    }
  }

}
