/**
 * Simulation mock data — what the optimizer WOULD do right now.
 *
 * Replace MOCK_SIMULATION with a real API call when the simulate endpoint is ready:
 *   const { data } = useMutation({
 *     mutationFn: () => optimizerApi.simulate(orgId),
 *   });
 *
 * Each SimulatedAction mirrors the real OptimizerAction shape but:
 *   1. Is never persisted — no id from DB, no status field
 *   2. Carries a projectedImpact array (Phase 1: rule-based estimates)
 *   3. Has isSimulated: true as a discriminator
 */

import type { ActionType } from '@/lib/api/optimizer';
import type { Platform } from '@/lib/api/campaigns';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImpactDirection = 'up' | 'down' | 'neutral';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SimulatedImpact {
  metric: string;      // translation key suffix: 'spend' | 'conversions' | 'cpa' | 'cpc' | 'roas' | 'impressions' | 'spendPacing'
  before: string;      // pre-formatted display value
  after: string;       // pre-formatted display value
  direction: ImpactDirection;
  confidence: ConfidenceLevel;
}

export interface SimulatedAction {
  readonly isSimulated: true;
  id: string;          // client-side id only, not from DB
  campaignId: string;
  campaignName: string;
  adSetId: string | null;
  adSetName: string | null;
  entityType: 'CAMPAIGN' | 'AD_SET';
  platform: Platform;
  actionType: ActionType;
  ruleName: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  explanation: { en: string; ar: string | null };
  projectedImpact: SimulatedImpact[];
  // When simulation was generated (set by the simulate endpoint or client-side for mock)
  simulatedAt: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────
//
// 6 actions covering all 5 ActionType values across 5 campaigns.
// Impact projections use rule-based estimates (Phase 1).
// In Phase 2+, these come from ML models.

export const MOCK_SIMULATION: SimulatedAction[] = [

  // ── 1. Budget increase — Ramadan META campaign ─────────────────────────────
  {
    isSimulated: true,
    id: 'sim-001',
    campaignId: 'cmp-001',
    campaignName: 'Ramadan Performance — Riyadh',
    adSetId: null,
    adSetName: null,
    entityType: 'CAMPAIGN',
    platform: 'META',
    actionType: 'INCREASE_BUDGET',
    ruleName: 'High ROAS — Budget Scale',
    before: { daily_budget_sar: 2600 },
    after:  { daily_budget_sar: 3000 },
    explanation: {
      en: 'ROAS has held above the 3.0× target for 3 consecutive 24-hour windows (current: 4.1×). Scaling daily budget +15.4% from SAR 2,600 to SAR 3,000 to capture additional high-quality conversions while efficiency remains strong.',
      ar: null,
    },
    projectedImpact: [
      { metric: 'spend',       before: 'SAR 2,600/day', after: 'SAR 3,000/day', direction: 'up',   confidence: 'HIGH'   },
      { metric: 'conversions', before: '~34/day',       after: '~39/day',       direction: 'up',   confidence: 'MEDIUM' },
      { metric: 'roas',        before: '4.1×',          after: '3.9×',          direction: 'down', confidence: 'LOW'    },
    ],
    simulatedAt: new Date().toISOString(),
  },

  // ── 2. Budget decrease — Retargeting META campaign ─────────────────────────
  {
    isSimulated: true,
    id: 'sim-002',
    campaignId: 'cmp-003',
    campaignName: 'Retargeting — Checkout Abandonment',
    adSetId: null,
    adSetName: null,
    entityType: 'CAMPAIGN',
    platform: 'META',
    actionType: 'DECREASE_BUDGET',
    ruleName: 'High CPA — Budget Reduction',
    before: { daily_budget_sar: 900 },
    after:  { daily_budget_sar: 810 },
    explanation: {
      en: 'CPA has exceeded the SAR 75 target for 2 consecutive windows (current: SAR 89). Reducing daily budget -10% from SAR 900 to SAR 810 to decrease spend pressure while the algorithm re-optimizes delivery.',
      ar: null,
    },
    projectedImpact: [
      { metric: 'spend',       before: 'SAR 900/day',  after: 'SAR 810/day',  direction: 'down', confidence: 'HIGH'   },
      { metric: 'cpa',         before: 'SAR 89',       after: '~SAR 80',      direction: 'down', confidence: 'MEDIUM' },
      { metric: 'conversions', before: '~10/day',      after: '~10/day',      direction: 'neutral', confidence: 'MEDIUM' },
    ],
    simulatedAt: new Date().toISOString(),
  },

  // ── 3. Bidding strategy switch — TikTok brand awareness ───────────────────
  {
    isSimulated: true,
    id: 'sim-003',
    campaignId: 'cmp-002',
    campaignName: 'Brand Awareness Q2 — KSA',
    adSetId: 'adset-002-a',
    adSetName: '18–34 Interest Targeting',
    entityType: 'AD_SET',
    platform: 'TIKTOK',
    actionType: 'SWITCH_BIDDING_STRATEGY',
    ruleName: 'Unstable CPA — Switch to Cost Cap',
    before: { bidding_strategy: 'LOWEST_COST' },
    after:  { bidding_strategy: 'COST_CAP', cost_cap_sar: 55 },
    explanation: {
      en: 'CPA variance across the 72-hour window is high (range: SAR 42–98). Switching from Lowest Cost to Cost Cap at SAR 55 to stabilize acquisition costs. Spend pacing may drop temporarily while the algorithm adjusts.',
      ar: null,
    },
    projectedImpact: [
      { metric: 'cpa',          before: 'SAR 42–98',    after: '~SAR 50–60',   direction: 'neutral', confidence: 'LOW'    },
      { metric: 'spendPacing',  before: '94%',          after: '~75–85%',      direction: 'down',    confidence: 'LOW'    },
    ],
    simulatedAt: new Date().toISOString(),
  },

  // ── 4. Bid ceiling reduction — Google Ads high-intent ─────────────────────
  {
    isSimulated: true,
    id: 'sim-004',
    campaignId: 'cmp-004',
    campaignName: 'Google Search — High Intent',
    adSetId: 'adset-004-a',
    adSetName: 'Purchase Intent Keywords',
    entityType: 'AD_SET',
    platform: 'GOOGLE_ADS',
    actionType: 'ADJUST_BID_CEILING',
    ruleName: 'High CPC — Lower Bid Ceiling',
    before: { bid_ceiling_sar: 18 },
    after:  { bid_ceiling_sar: 15.8 },
    explanation: {
      en: 'CPC has risen to SAR 17.40 over the last 48 hours without a corresponding CTR improvement (CTR: 2.1%). Reducing bid ceiling -12% from SAR 18 to SAR 15.80 to lower average CPC while maintaining reach.',
      ar: null,
    },
    projectedImpact: [
      { metric: 'cpc',         before: 'SAR 17.40',    after: '~SAR 15.00',   direction: 'down', confidence: 'MEDIUM' },
      { metric: 'impressions', before: '~4,200/day',   after: '~3,900/day',   direction: 'down', confidence: 'MEDIUM' },
    ],
    simulatedAt: new Date().toISOString(),
  },

  // ── 5. Budget increase — Snapchat Jeddah (high pacing) ────────────────────
  {
    isSimulated: true,
    id: 'sim-005',
    campaignId: 'cmp-005',
    campaignName: 'Snapchat Discover — Jeddah',
    adSetId: null,
    adSetName: null,
    entityType: 'CAMPAIGN',
    platform: 'SNAPCHAT',
    actionType: 'INCREASE_BUDGET',
    ruleName: 'Strong Pacing — Scale Budget',
    before: { daily_budget_sar: 1200 },
    after:  { daily_budget_sar: 1440 },
    explanation: {
      en: 'Spend pacing has reached 98% for 3 consecutive windows, indicating the campaign is budget-constrained. ROAS is 2.8× against the 2.5× target. Increasing daily budget +20% from SAR 1,200 to SAR 1,440 to remove the delivery constraint.',
      ar: null,
    },
    projectedImpact: [
      { metric: 'spend',       before: 'SAR 1,200/day', after: 'SAR 1,440/day', direction: 'up', confidence: 'HIGH'   },
      { metric: 'impressions', before: '~31,000/day',   after: '~37,000/day',   direction: 'up', confidence: 'HIGH'   },
      { metric: 'roas',        before: '2.8×',          after: '~2.7×',         direction: 'down', confidence: 'LOW'  },
    ],
    simulatedAt: new Date().toISOString(),
  },

  // ── 6. Bid floor increase — META Ramadan ad set ────────────────────────────
  {
    isSimulated: true,
    id: 'sim-006',
    campaignId: 'cmp-001',
    campaignName: 'Ramadan Performance — Riyadh',
    adSetId: 'adset-001-b',
    adSetName: 'Lookalike — Top 5% Purchasers',
    entityType: 'AD_SET',
    platform: 'META',
    actionType: 'ADJUST_BID_FLOOR',
    ruleName: 'Weak Delivery — Raise Bid Floor',
    before: { bid_floor_sar: 0 },
    after:  { bid_floor_sar: 3.5 },
    explanation: {
      en: 'Delivery rate has dropped to 61% of expected pacing in the last 24 hours despite healthy ROAS (3.6×). Setting a bid floor of SAR 3.50 to signal minimum bid willingness and improve auction competitiveness for high-value placements.',
      ar: null,
    },
    projectedImpact: [
      { metric: 'spendPacing',  before: '61%',    after: '~75–85%',   direction: 'up',   confidence: 'MEDIUM' },
      { metric: 'cpc',          before: 'SAR 6.20', after: '~SAR 6.80', direction: 'up', confidence: 'LOW'    },
    ],
    simulatedAt: new Date().toISOString(),
  },

];
