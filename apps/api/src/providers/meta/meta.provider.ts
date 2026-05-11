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
import { MetaApiClient } from './meta-api.client';
import { MetaMapperService } from './meta-mapper.service';
import { MetaTokenService } from './meta-token.service';
import { majorToMinor } from './meta.constants';
import {
  MetaCampaign,
  MetaAdSet,
  MetaInsightsResponse,
} from './dto/meta-raw.types';
import { AdAccount } from '@prisma/client';

// MetaProvider implements IAdProvider for the META platform.
//
// Mock fallback: when adAccount.status === 'MOCK', every method delegates
// to MockProvider. This lets developers exercise the full optimizer flow
// without real Facebook credentials.
//
// Phase 1 capabilities (see getCapabilities):
//   - CBO: yes
//   - Lifetime budget: yes
//   - Bid ceiling: yes (via bid_amount on cap strategies)
//   - Bid floor: NO (Meta has no native ad-set floor)
//   - ROAS goal: yes (LOWEST_COST_WITH_MIN_ROAS)
//   - CPA goal: yes (TARGET_COST)
//   - Campaign creation: NO at Phase 1 (delegated to mock until Phase 2 review)

@Injectable()
export class MetaProvider implements IAdProvider {
  readonly platform: Platform = 'META';
  private readonly logger = new Logger(MetaProvider.name);

  constructor(
    private mock: MockProvider,
    private loader: AdAccountLoader,
    private api: MetaApiClient,
    private mapper: MetaMapperService,
    private tokens: MetaTokenService,
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsCbo:              true,
      supportsLifetimeBudget:   true,
      supportsBidFloor:         false,   // Meta has no ad-set bid floor
      supportsBidCeiling:       true,
      supportsRoasGoal:         true,
      supportsCpaGoal:          true,
      supportsCampaignCreation: false,   // requires app review — Phase 2
      supportsCreativeUpload:   false,   // Phase 2
    };
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  async validateCredentials(account: AdAccountRef): Promise<boolean> {
    const loaded = await this.loadOrMock(account, true);
    if (!loaded) return this.mock.validateCredentials(account);
    try {
      await this.api.get<{ id: string }>('/me', loaded.accessToken, { fields: 'id' });
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

    const fields = [
      'id', 'name', 'status', 'effective_status', 'objective',
      'daily_budget', 'lifetime_budget', 'start_time', 'stop_time', 'budget_remaining',
    ].join(',');

    const raw = await this.api.getPaginated<MetaCampaign>(
      `/${account.externalId}/campaigns`,
      loaded.accessToken,
      { fields, limit: 200 },
      account.externalId,
    );
    return raw.map((c) => this.mapper.toNormalizedCampaign(c));
  }

  async fetchAdSets(
    account: AdAccountRef,
    campaignExternalId: string,
  ): Promise<NormalizedAdSet[]> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.fetchAdSets(account, campaignExternalId);

    const fields = [
      'id', 'name', 'campaign_id', 'status', 'effective_status',
      'daily_budget', 'lifetime_budget', 'bid_strategy', 'bid_amount',
      'optimization_goal', 'billing_event', 'start_time', 'end_time',
    ].join(',');

    const raw = await this.api.getPaginated<MetaAdSet>(
      `/${campaignExternalId}/adsets`,
      loaded.accessToken,
      { fields, limit: 200 },
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
    const today = new Date();
    const since = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const fields = [
      'spend', 'impressions', 'clicks', 'ctr', 'cpc',
      'reach', 'frequency', 'actions', 'action_values',
    ].join(',');

    const res = await this.api.get<MetaInsightsResponse>(
      `/${externalId}/insights`,
      loaded.accessToken,
      {
        fields,
        time_range: JSON.stringify({ since: fmt(since), until: fmt(today) }),
        time_increment: '1',
        level: entityType === 'CAMPAIGN' ? 'campaign' : 'adset',
      },
      account.externalId,
    );
    return this.mapper.toNormalizedMetrics(
      res.data ?? [],
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
      await this.api.post<{ success?: boolean }>(
        `/${params.externalId}`,
        loaded.accessToken,
        { daily_budget: majorToMinor(params.newDailyBudget) },
        account.externalId,
      );
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
      await this.api.post<unknown>(
        `/${params.adSetExternalId}`,
        loaded.accessToken,
        {
          bid_strategy: this.toMetaBidStrategy(params.newStrategy),
          ...(params.newBidAmount !== null
            ? { bid_amount: majorToMinor(params.newBidAmount) }
            : {}),
        },
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

    // Honest-failure gate: Meta has no native ad-set bid floor (see
    // getCapabilities().supportsBidFloor=false). The guardrail in the
    // optimizer is the primary line of defense; this check is defense-in-depth
    // for any direct caller. We must NOT silently return success — that would
    // cause the executor to record APPLIED for a no-op write.
    if (params.newBidFloor !== null) {
      this.logger.warn(
        `Meta does not support ad-set bid floor; refusing newBidFloor=${params.newBidFloor} for ${params.adSetExternalId}`,
      );
      return {
        success: false,
        externalId: params.adSetExternalId,
        platform: this.platform,
        appliedAt: new Date().toISOString(),
        errorCode: 'UNSUPPORTED',
        errorMessage: 'Meta has no ad-set bid floor (supportsBidFloor=false)',
        providerResponse: null,
      };
    }

    return this.mutation(async () => {
      const body: Record<string, unknown> = {};
      if (params.newBidCeiling !== null) body.bid_amount = majorToMinor(params.newBidCeiling);
      if (Object.keys(body).length > 0) {
        await this.api.post<unknown>(
          `/${params.adSetExternalId}`,
          loaded.accessToken,
          body,
          account.externalId,
        );
      }
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

  // Returns null when the resolved AdAccount is in MOCK status (caller falls
  // through to MockProvider). Throws ProviderError on other lookup failures.
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

  private async mutation(
    fn: () => Promise<string>,
    fallbackExternalId: string,
  ): Promise<ProviderActionResult> {
    try {
      const externalId = await fn();
      return {
        success:          true,
        externalId,
        platform:         'META',
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
        platform:         'META',
        appliedAt:        new Date().toISOString(),
        errorCode:        pe?.providerCode ?? 'UNKNOWN',
        errorMessage:     (err as Error).message,
        providerResponse: pe?.raw ?? null,
      };
    }
  }

  private toMetaBidStrategy(s: BiddingStrategy): string {
    switch (s) {
      case BiddingStrategy.LOWEST_COST: return 'LOWEST_COST_WITHOUT_CAP';
      case BiddingStrategy.BID_CAP:     return 'LOWEST_COST_WITH_BID_CAP';
      case BiddingStrategy.COST_CAP:    return 'COST_CAP';
      case BiddingStrategy.TARGET_CPA:  return 'TARGET_COST';
      case BiddingStrategy.TARGET_ROAS: return 'LOWEST_COST_WITH_MIN_ROAS';
    }
  }
}
