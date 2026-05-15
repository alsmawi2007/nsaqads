import { api } from './client';

export type Platform = 'META' | 'TIKTOK' | 'GOOGLE_ADS' | 'SNAPCHAT';
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED';
export type CampaignPhase = 'LEARNING' | 'STABLE' | 'SCALING' | 'DEGRADED';
export type OptimizerMode = 'OFF' | 'SUGGEST_ONLY' | 'AUTO_APPLY';

export interface Campaign {
  id: string;
  orgId: string;
  adAccountId: string;
  externalId: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  objective: string | null;
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  isCbo: boolean;
  campaignPhase: CampaignPhase;
  optimizerMode: OptimizerMode;
  optimizerEnabled: boolean;
  syncedAt: string | null;
  adAccount: { id: string; name: string | null; currency: string };
}

export interface AdSet {
  id: string;
  orgId: string;
  campaignId: string;
  externalId: string;
  name: string;
  status: CampaignStatus;
  dailyBudget: string | null;
  biddingStrategy: string | null;
  bidAmount: string | null;
  bidFloor: string | null;
  bidCeiling: string | null;
  optimizerMode: OptimizerMode;
}

export interface MetricSnapshot {
  id: string;
  entityType: string;
  entityId: string;
  windowHours: number;
  snapshotDate: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  conversions: string;
  cpa: string;
  revenue: string;
  roas: string;
  reach: string;
  frequency: string;
  spendPacing: string;
}

export const campaignsApi = {
  list: (orgId: string, params?: { platform?: string; status?: string; phase?: string }) => {
    const qs = params
      ? '?' + new URLSearchParams(Object.fromEntries(
          Object.entries(params).filter(([, v]) => v != null) as [string, string][]
        )).toString()
      : '';
    return api.get<Campaign[]>(`/orgs/${orgId}/campaigns${qs}`);
  },

  get: (orgId: string, campaignId: string) =>
    api.get<Campaign>(`/orgs/${orgId}/campaigns/${campaignId}`),

  updateOptimizer: (
    orgId: string,
    campaignId: string,
    body: { optimizerMode?: OptimizerMode; optimizerEnabled?: boolean },
  ) => api.patch(`/orgs/${orgId}/campaigns/${campaignId}/optimizer`, body),

  listAdSets: (orgId: string, campaignId: string) =>
    api.get<AdSet[]>(`/orgs/${orgId}/campaigns/${campaignId}/adsets`),

  getAdSets: (orgId: string, campaignId: string) =>
    api.get<AdSet[]>(`/orgs/${orgId}/campaigns/${campaignId}/adsets`),

  getMetrics: (orgId: string, campaignId: string, window: 24 | 48 | 72 = 24) =>
    api.get<MetricSnapshot>(`/orgs/${orgId}/campaigns/${campaignId}/metrics?window=${window}`),

  getAdSetMetrics: (orgId: string, campaignId: string, adSetId: string, window: 24 | 48 | 72 = 24) =>
    api.get<MetricSnapshot>(
      `/orgs/${orgId}/campaigns/${campaignId}/adsets/${adSetId}/metrics?window=${window}`,
    ),

  // Testing override — moves a campaign between optimizer phases. Production
  // transitions happen automatically; this is for activation testing.
  setPhase: (orgId: string, campaignId: string, phase: CampaignPhase, reason: string) =>
    api.patch<Campaign>(`/orgs/${orgId}/campaigns/${campaignId}/phase`, { phase, reason }),
};

// Derive a human-readable budget source from a Campaign row. Snap, TikTok,
// and Google often expose budgets at the ad-set/ad-group level instead of
// the campaign, so a plain "—" is misleading.
export function budgetSourceLabel(c: Campaign): 'campaign-daily' | 'campaign-lifetime' | 'ad-set' | 'unknown' {
  if (c.dailyBudget !== null && c.dailyBudget !== undefined && c.dailyBudget !== '0' && Number(c.dailyBudget) > 0) return 'campaign-daily';
  if (c.lifetimeBudget !== null && c.lifetimeBudget !== undefined && c.lifetimeBudget !== '0' && Number(c.lifetimeBudget) > 0) return 'campaign-lifetime';
  if (c.isCbo === false) return 'ad-set';
  return 'unknown';
}
