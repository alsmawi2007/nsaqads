import { Injectable, Logger } from '@nestjs/common';
import {
  AdAccountRef,
  BiddingStrategy,
  CreativeDraft,
  FetchMetricsHints,
  IAdProvider,
  NormalizedAdDraft,
  NormalizedAdSet,
  NormalizedAdSetDraft,
  NormalizedCampaign,
  NormalizedCampaignDraft,
  NormalizedMetrics,
  Platform,
  ProviderActionResult,
  ProviderCapabilities,
  UpdateBidLimitsParams,
  UpdateBiddingStrategyParams,
  UpdateBudgetParams,
} from '../interfaces/ad-provider.interface';
import { MockProvider } from '../mock/mock.provider';
import { AdAccountLoader } from '../shared/ad-account.loader';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { GoogleAdsApiClient } from './google-ads-api.client';
import { GoogleAdsMapperService } from './google-ads-mapper.service';
import { GoogleAdsTokenService } from './google-ads-token.service';
import { majorToMicros } from './google-ads.constants';
import {
  GoogleAdsCampaignBudgetFields,
  GoogleAdsSearchRow,
} from './dto/google-ads-raw.types';
import { AdAccount } from '@prisma/client';

// GoogleAdsProvider implements IAdProvider for the GOOGLE_ADS platform.
//
// Mock fallback: when adAccount.status === 'MOCK', every method delegates to
// MockProvider. This lets developers exercise the optimizer without real
// Google Ads credentials or developer-token approval.
//
// Phase 1 capabilities:
//   - CBO: yes (Google Ads budgets always live at the campaign level)
//   - Lifetime budget: no (DAILY only in our normalized path)
//   - Bid ceiling: yes (cpc_bid_ceiling on TARGET_CPA / TARGET_ROAS strategies)
//   - Bid floor: no (Google Ads has cpc_bid_floor only on a few strategies and
//     it isn't surfaced consistently in v18 — capability gated off)
//   - ROAS goal: yes (TARGET_ROAS)
//   - CPA goal: yes (TARGET_CPA)
//   - Campaign creation: NO at Phase 1 (delegated to mock until Phase 2 review)

@Injectable()
export class GoogleAdsProvider implements IAdProvider {
  readonly platform: Platform = 'GOOGLE_ADS';
  private readonly logger = new Logger(GoogleAdsProvider.name);

  constructor(
    private mock: MockProvider,
    private loader: AdAccountLoader,
    private api: GoogleAdsApiClient,
    private mapper: GoogleAdsMapperService,
    private tokens: GoogleAdsTokenService,
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      supportsCbo:              true,
      supportsLifetimeBudget:   false,
      supportsBidFloor:         false,  // not surfaced uniformly in v18
      supportsBidCeiling:       true,
      supportsRoasGoal:         true,
      supportsCpaGoal:          true,
      supportsCampaignCreation: false,  // Phase 2 — pending app/devtoken review
      supportsCreativeUpload:   false,  // Phase 2
    };
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  async validateCredentials(account: AdAccountRef): Promise<boolean> {
    const loaded = await this.loadOrMock(account, false);
    if (!loaded) return this.mock.validateCredentials(account);
    try {
      // Cheapest possible call: list accessible customers. Doesn't depend on
      // developer-token having permission for THIS customer specifically.
      await this.api.listAccessibleCustomers(loaded.accessToken);
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

    // GAQL: pull campaigns and the linked campaign_budget in one query so we
    // can populate dailyBudget without a follow-up call.
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.advertising_channel_sub_type,
        campaign.start_date,
        campaign.end_date,
        campaign.bidding_strategy_type,
        campaign.campaign_budget,
        campaign_budget.id,
        campaign_budget.amount_micros,
        campaign_budget.total_amount_micros,
        campaign_budget.period
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `;

    const rows = await this.api.searchAll(account.externalId, loaded.accessToken, query);
    return rows
      .filter((r): r is GoogleAdsSearchRow & { campaign: NonNullable<GoogleAdsSearchRow['campaign']> } => Boolean(r.campaign))
      .map((r) => this.mapper.toNormalizedCampaign(r.campaign, r.campaignBudget));
  }

  async fetchAdSets(
    account: AdAccountRef,
    campaignExternalId: string,
  ): Promise<NormalizedAdSet[]> {
    const loaded = await this.loadOrMock(account);
    if (!loaded) return this.mock.fetchAdSets(account, campaignExternalId);

    const query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.campaign,
        ad_group.cpc_bid_micros,
        ad_group.cpm_bid_micros,
        ad_group.target_cpa_micros
      FROM ad_group
      WHERE
        ad_group.campaign = 'customers/${account.externalId}/campaigns/${campaignExternalId}'
        AND ad_group.status != 'REMOVED'
    `;

    const rows = await this.api.searchAll(account.externalId, loaded.accessToken, query);
    return rows
      .filter((r): r is GoogleAdsSearchRow & { adGroup: NonNullable<GoogleAdsSearchRow['adGroup']> } => Boolean(r.adGroup))
      .map((r) => this.mapper.toNormalizedAdSet(r.adGroup, campaignExternalId));
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

    const resourceFilter =
      entityType === 'CAMPAIGN'
        ? `campaign.id = ${externalId}`
        : `ad_group.id = ${externalId}`;
    const fromTable = entityType === 'CAMPAIGN' ? 'campaign' : 'ad_group';

    const query = `
      SELECT
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,
        metrics.cost_per_conversion,
        segments.date
      FROM ${fromTable}
      WHERE
        ${resourceFilter}
        AND segments.date BETWEEN '${fmt(since)}' AND '${fmt(today)}'
    `;

    const rows = await this.api.searchAll(account.externalId, loaded.accessToken, query);
    return this.mapper.toNormalizedMetrics(
      rows,
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
      // Google Ads budgets live on a CampaignBudget resource, not the
      // Campaign. We resolve the campaign → its campaign_budget resource
      // name and mutate that.
      if (params.entityType !== 'CAMPAIGN') {
        // Ad groups have no budget in Google Ads. The optimizer should
        // already have routed this to a campaign-level action via
        // capabilities + isCbo, but defense in depth.
        throw new ProviderError(
          ProviderErrorKind.VALIDATION,
          'GOOGLE_ADS',
          'Google Ads ad groups have no budget; budget actions must target CAMPAIGN entities.',
        );
      }
      const budgetResource = await this.lookupCampaignBudget(
        account,
        loaded.accessToken,
        params.externalId,
      );
      if (!budgetResource) {
        throw new ProviderError(
          ProviderErrorKind.NOT_FOUND,
          'GOOGLE_ADS',
          `Campaign ${params.externalId} has no associated campaign_budget resource`,
        );
      }
      await this.api.mutate(
        account.externalId,
        loaded.accessToken,
        'campaignBudgets:mutate',
        [
          {
            update: {
              resourceName: budgetResource,
              amountMicros: majorToMicros(params.newDailyBudget),
            },
            updateMask: 'amount_micros',
          },
        ],
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

    // In Google Ads, bidding strategy is a campaign-level configuration. The
    // adSetExternalId we receive is, by convention from the optimizer's
    // entityType routing, actually a campaign id when the strategy switches
    // come for Google Ads. The evaluator already filters strategy actions to
    // be ad-set-scoped, so on Google Ads we resolve the ad group's parent
    // campaign and update there.
    return this.mutation(async () => {
      const campaignId = await this.resolveCampaignFromAdGroup(
        account,
        loaded.accessToken,
        params.adSetExternalId,
      );
      const update: Record<string, unknown> = {
        resourceName: `customers/${account.externalId}/campaigns/${campaignId}`,
        biddingStrategyType: this.toGoogleBidStrategy(params.newStrategy),
      };
      const masks: string[] = ['bidding_strategy_type'];

      if (params.newBidAmount !== null) {
        if (params.newStrategy === BiddingStrategy.TARGET_CPA) {
          update.targetCpa = { targetCpaMicros: majorToMicros(params.newBidAmount) };
          masks.push('target_cpa.target_cpa_micros');
        } else if (params.newStrategy === BiddingStrategy.TARGET_ROAS) {
          // ROAS target is a ratio (e.g. 4.0 = 400%), not micros.
          update.targetRoas = { targetRoas: params.newBidAmount };
          masks.push('target_roas.target_roas');
        }
      }

      await this.api.mutate(
        account.externalId,
        loaded.accessToken,
        'campaigns:mutate',
        [{ update, updateMask: masks.join(',') }],
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

    // Honest-failure gate: bid floor is not surfaced in our v18 normalized
    // path (see getCapabilities().supportsBidFloor=false). The guardrail in
    // the optimizer is the primary line of defense; this check is
    // defense-in-depth for any direct caller. We must NOT silently return
    // success — that would cause the executor to record APPLIED for a no-op.
    if (params.newBidFloor !== null) {
      this.logger.warn(
        `Google Ads bid floor not supported in v18 normalized path; refusing newBidFloor=${params.newBidFloor} for ${params.adSetExternalId}`,
      );
      return {
        success: false,
        externalId: params.adSetExternalId,
        platform: this.platform,
        appliedAt: new Date().toISOString(),
        errorCode: 'UNSUPPORTED',
        errorMessage: 'Google Ads bid floor is not supported (supportsBidFloor=false)',
        providerResponse: null,
      };
    }

    return this.mutation(async () => {
      if (params.newBidCeiling === null) {
        // Nothing to do — return the id without mutating.
        return params.adSetExternalId;
      }
      // Bid ceilings live on the campaign's TARGET_CPA or TARGET_ROAS sub-
      // resource. We resolve the ad group's parent campaign and update there.
      const campaignId = await this.resolveCampaignFromAdGroup(
        account,
        loaded.accessToken,
        params.adSetExternalId,
      );
      // Without knowing the active strategy, set the ceiling on whichever
      // sub-resource exists. We send both updateMask paths — Google ignores
      // mask paths for sub-resources that aren't present, so this is safe.
      const ceilingMicros = majorToMicros(params.newBidCeiling);
      await this.api.mutate(
        account.externalId,
        loaded.accessToken,
        'campaigns:mutate',
        [
          {
            update: {
              resourceName: `customers/${account.externalId}/campaigns/${campaignId}`,
              targetCpa:  { cpcBidCeilingMicros: ceilingMicros },
              targetRoas: { cpcBidCeilingMicros: ceilingMicros },
            },
            updateMask: 'target_cpa.cpc_bid_ceiling_micros,target_roas.cpc_bid_ceiling_micros',
          },
        ],
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
      // Token may have been rotated above; reload to get the fresh access token.
      return this.loader.load(account);
    }
    return loaded;
  }

  private async lookupCampaignBudget(
    account: AdAccountRef,
    accessToken: string,
    campaignId: string,
  ): Promise<string | null> {
    const query = `
      SELECT campaign.campaign_budget
      FROM campaign
      WHERE campaign.id = ${campaignId}
      LIMIT 1
    `;
    const rows = await this.api.searchAll(account.externalId, accessToken, query, 1);
    const row: GoogleAdsSearchRow | undefined = rows[0];
    return row?.campaign?.campaignBudget ?? null;
  }

  private async resolveCampaignFromAdGroup(
    account: AdAccountRef,
    accessToken: string,
    adGroupId: string,
  ): Promise<string> {
    const query = `
      SELECT ad_group.campaign
      FROM ad_group
      WHERE ad_group.id = ${adGroupId}
      LIMIT 1
    `;
    const rows = await this.api.searchAll(account.externalId, accessToken, query, 1);
    const row: GoogleAdsSearchRow | undefined = rows[0];
    const resourceName = row?.adGroup?.campaign;
    if (!resourceName) {
      throw new ProviderError(
        ProviderErrorKind.NOT_FOUND,
        'GOOGLE_ADS',
        `Could not resolve parent campaign for ad_group ${adGroupId}`,
      );
    }
    // resourceName is 'customers/.../campaigns/<id>'
    const parts = resourceName.split('/');
    return parts[parts.length - 1];
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
        platform:         'GOOGLE_ADS',
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
        platform:         'GOOGLE_ADS',
        appliedAt:        new Date().toISOString(),
        errorCode:        pe?.providerCode ?? 'UNKNOWN',
        errorMessage:     (err as Error).message,
        providerResponse: pe?.raw ?? null,
      };
    }
  }

  private toGoogleBidStrategy(s: BiddingStrategy): string {
    switch (s) {
      case BiddingStrategy.LOWEST_COST: return 'MAXIMIZE_CONVERSIONS';
      case BiddingStrategy.BID_CAP:     return 'MANUAL_CPC';
      case BiddingStrategy.COST_CAP:    return 'TARGET_CPA';
      case BiddingStrategy.TARGET_CPA:  return 'TARGET_CPA';
      case BiddingStrategy.TARGET_ROAS: return 'TARGET_ROAS';
    }
  }
}

// Note: GoogleAdsCampaignBudgetFields import is consumed indirectly via the
// search response shape; the explicit type re-export keeps tooling happy in
// case future refactors break the inference chain.
export type _GoogleAdsCampaignBudgetFields = GoogleAdsCampaignBudgetFields;
