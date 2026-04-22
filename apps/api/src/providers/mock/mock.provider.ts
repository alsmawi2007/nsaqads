import { Injectable } from '@nestjs/common';
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
}
