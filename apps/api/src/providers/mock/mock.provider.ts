import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IAdProvider,
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedMetrics,
  UpdateBudgetParams,
  UpdateBiddingStrategyParams,
  UpdateBidLimitsParams,
  ProviderActionResult,
  BiddingStrategy,
  Platform,
  NormalizedCampaignDraft,
  NormalizedAdSetDraft,
  CreativeDraft,
  NormalizedAdDraft,
} from '../interfaces/ad-provider.interface';

// MockProvider satisfies IAdProvider for all platforms in development.
// ProviderFactory selects this when NODE_ENV=development or adAccount.status=MOCK.
@Injectable()
export class MockProvider implements IAdProvider {
  readonly platform: Platform = 'META'; // overridden by factory at runtime

  async validateCredentials(_adAccountId: string): Promise<boolean> {
    return true;
  }

  async refreshAccessToken(_adAccountId: string): Promise<void> {}

  async fetchCampaigns(adAccountId: string): Promise<NormalizedCampaign[]> {
    return [
      {
        externalId: `mock-campaign-${adAccountId}-1`,
        name: 'Mock Campaign — Conversions',
        status: 'ACTIVE',
        objective: 'CONVERSIONS',
        dailyBudget: 500,
        lifetimeBudget: null,
        startDate: '2026-01-01',
        endDate: null,
        isCbo: false,
      },
    ];
  }

  async fetchAdSets(adAccountId: string, campaignExternalId: string): Promise<NormalizedAdSet[]> {
    return [
      {
        externalId: `mock-adset-${adAccountId}-1`,
        campaignExternalId,
        name: 'Mock Ad Set — Broad Audience',
        status: 'ACTIVE',
        dailyBudget: 500,
        biddingStrategy: BiddingStrategy.LOWEST_COST,
        bidAmount: null,
        bidFloor: null,
        bidCeiling: null,
      },
    ];
  }

  async fetchMetrics(
    _adAccountId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    externalId: string,
    windowHours: 24 | 48 | 72,
  ): Promise<NormalizedMetrics> {
    const spend = windowHours * 20; // ~SAR 480 / 72h
    const impressions = windowHours * 1000;
    const clicks = Math.floor(impressions * 0.025);
    const conversions = Math.floor(clicks * 0.05);
    const revenue = conversions * 150;

    return {
      externalId,
      entityType,
      windowHours,
      dateStart: new Date(Date.now() - windowHours * 3600_000).toISOString().split('T')[0],
      dateEnd: new Date().toISOString().split('T')[0],
      spend,
      impressions,
      clicks,
      ctr: clicks / impressions,
      cpc: spend / clicks,
      conversions,
      cpa: spend / (conversions || 1),
      revenue,
      roas: revenue / (spend || 1),
      reach: Math.floor(impressions * 0.8),
      frequency: impressions / (impressions * 0.8),
      spendPacing: windowHours === 24 ? 0.85 : 0.9,
    };
  }

  async updateBudget(
    _adAccountId: string,
    params: UpdateBudgetParams,
  ): Promise<ProviderActionResult> {
    return {
      success: true,
      externalId: params.externalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: { mock: true, newBudget: params.newDailyBudget },
    };
  }

  async updateBiddingStrategy(
    _adAccountId: string,
    params: UpdateBiddingStrategyParams,
  ): Promise<ProviderActionResult> {
    return {
      success: true,
      externalId: params.adSetExternalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: { mock: true, newStrategy: params.newStrategy },
    };
  }

  async updateBidLimits(
    _adAccountId: string,
    params: UpdateBidLimitsParams,
  ): Promise<ProviderActionResult> {
    return {
      success: true,
      externalId: params.adSetExternalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: {
        mock: true,
        newBidFloor: params.newBidFloor,
        newBidCeiling: params.newBidCeiling,
      },
    };
  }

  // ─── Creation (Campaign Architect) ───────────────────────────────────────
  // Synthetic IDs are a deterministic hash of the inputs so the same draft
  // produces the same external id on retry — this lets the Launcher use
  // externalCampaignId as an idempotency key without extra bookkeeping.

  async createCampaign(
    adAccountId: string,
    draft: NormalizedCampaignDraft,
  ): Promise<ProviderActionResult> {
    const externalId = this.deterministicId('campaign', [
      this.platform,
      adAccountId,
      draft.name,
      draft.objective,
      String(draft.isCbo),
    ]);
    return {
      success: true,
      externalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: { mock: true, created: 'campaign', draft },
    };
  }

  async createAdSet(
    adAccountId: string,
    draft: NormalizedAdSetDraft,
  ): Promise<ProviderActionResult> {
    const externalId = this.deterministicId('adset', [
      this.platform,
      adAccountId,
      draft.campaignExternalId,
      draft.name,
      draft.biddingStrategy,
    ]);
    return {
      success: true,
      externalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: { mock: true, created: 'adset', draft },
    };
  }

  async uploadCreative(
    adAccountId: string,
    draft: CreativeDraft,
  ): Promise<ProviderActionResult> {
    const externalId = this.deterministicId('creative', [
      this.platform,
      adAccountId,
      draft.name,
      ...draft.assetRefs,
    ]);
    return {
      success: true,
      externalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: { mock: true, created: 'creative', draft },
    };
  }

  async createAd(
    adAccountId: string,
    draft: NormalizedAdDraft,
  ): Promise<ProviderActionResult> {
    const externalId = this.deterministicId('ad', [
      this.platform,
      adAccountId,
      draft.adSetExternalId,
      draft.creativeExternalId,
      draft.name,
    ]);
    return {
      success: true,
      externalId,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
      providerResponse: { mock: true, created: 'ad', draft },
    };
  }

  private deterministicId(kind: string, parts: string[]): string {
    const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
    return `mock-${kind}-${hash}`;
  }
}
