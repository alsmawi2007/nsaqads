/**
 * Optimizer Actions mock data — 16 actions across 4 days, covering all
 * ActionType and ActionStatus values. Explanations are human-readable prose
 * matching what the backend explanation field will contain.
 *
 * Replace MOCK_ACTIONS with a useQuery() call to go live:
 *   const { data } = useQuery({ queryKey: ['optimizer-actions', orgId, filters],
 *                               queryFn: () => optimizerApi.listActions(orgId, filters) });
 */

import type { ActionStatus, ActionType, TriggeredBy } from '@/lib/api/optimizer';
import type { Platform } from '@/lib/api/campaigns';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockOptimizerAction {
  id: string;
  campaignId: string;
  campaignName: string;
  adSetId: string | null;
  adSetName: string | null;
  entityType: 'CAMPAIGN' | 'AD_SET';
  platform: Platform;
  actionType: ActionType;
  status: ActionStatus;
  triggeredBy: TriggeredBy;
  ruleName: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  explanation: { en: string; ar: string | null };
  errorMessage: string | null;
  createdAt: string;
  appliedAt: string | null;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}
function daysAgo(d: number, extraHours = 0) {
  return hoursAgo(d * 24 + extraHours);
}

// ─── Campaign roster (matches mock dashboard campaigns) ───────────────────────

export const MOCK_CAMPAIGN_LIST = [
  { id: 'cmp-001', name: 'Ramadan Performance — Riyadh',       platform: 'META'       as Platform },
  { id: 'cmp-002', name: 'Brand Awareness Q2 — KSA',           platform: 'TIKTOK'     as Platform },
  { id: 'cmp-003', name: 'Retargeting — Checkout Abandonment', platform: 'META'       as Platform },
  { id: 'cmp-004', name: 'Google Search — High Intent',        platform: 'GOOGLE_ADS' as Platform },
  { id: 'cmp-005', name: 'Snapchat Discover — Jeddah',         platform: 'SNAPCHAT'   as Platform },
];

// ─── Mock actions ─────────────────────────────────────────────────────────────

export const MOCK_ACTIONS: MockOptimizerAction[] = [

  // ── Today ──────────────────────────────────────────────────────────────────

  {
    id: 'act-t01',
    campaignId: 'cmp-001', campaignName: 'Ramadan Performance — Riyadh',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'META',
    actionType: 'INCREASE_BUDGET', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'High ROAS — Budget Scale',
    before: { daily_budget_sar: 2600 },
    after:  { daily_budget_sar: 3000 },
    explanation: {
      en: 'ROAS reached 4.1x against the 3.0x target across 3 consecutive 24-hour windows. Budget increased by +15.4% from SAR 2,600 to SAR 3,000 to capture additional high-quality conversions.',
      ar: null,
    },
    errorMessage: null,
    createdAt: hoursAgo(0.25), appliedAt: hoursAgo(0.22),
  },

  {
    id: 'act-t02',
    campaignId: 'cmp-003', campaignName: 'Retargeting — Checkout Abandonment',
    adSetId: 'ads-003a', adSetName: 'Warm Audience — 7-day visitors',
    entityType: 'AD_SET', platform: 'META',
    actionType: 'ADJUST_BID_CEILING', status: 'PENDING', triggeredBy: 'SCHEDULER',
    ruleName: 'Pacing Near Cap — Bid Lift',
    before: { bid_ceiling_sar: 12.0 },
    after:  { bid_ceiling_sar: 15.0 },
    explanation: {
      en: 'Spend pacing at 99% with ROAS 5.6x — the ad set is delivery-constrained, not budget-constrained. Raising the bid ceiling from SAR 12.00 to SAR 15.00 should unlock additional impression volume at this ROAS level.',
      ar: null,
    },
    errorMessage: null,
    createdAt: hoursAgo(0.6), appliedAt: null,
  },

  {
    id: 'act-t03',
    campaignId: 'cmp-002', campaignName: 'Brand Awareness Q2 — KSA',
    adSetId: 'ads-002a', adSetName: 'Interest Targeting — Fashion & Lifestyle',
    entityType: 'AD_SET', platform: 'TIKTOK',
    actionType: 'SWITCH_BIDDING_STRATEGY', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'CPA Breach — Strategy Downgrade',
    before: { bidding_strategy: 'LOWEST_COST' },
    after:  { bidding_strategy: 'COST_CAP', cost_cap_sar: 18.0 },
    explanation: {
      en: 'CPA rose to SAR 14.20 — 18% above the SAR 12.00 target — for 2 consecutive evaluation windows. Switching from Lowest Cost to Cost Cap at SAR 18.00 introduces a spending ceiling to prevent further CPA deterioration while the algorithm recalibrates.',
      ar: null,
    },
    errorMessage: null,
    createdAt: hoursAgo(3.5), appliedAt: hoursAgo(3.4),
  },

  {
    id: 'act-t04',
    campaignId: 'cmp-004', campaignName: 'Google Search — High Intent',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'GOOGLE_ADS',
    actionType: 'INCREASE_BUDGET', status: 'SKIPPED', triggeredBy: 'SCHEDULER',
    ruleName: 'Low Pacing — Budget Relief',
    before: { daily_budget_sar: 2000 },
    after:  { daily_budget_sar: 2300 },
    explanation: {
      en: 'Campaign is in the LEARNING phase (day 4 of 7). Optimizer interventions are paused until the learning phase completes to avoid disrupting the platform\'s calibration process. This rule will be re-evaluated automatically.',
      ar: null,
    },
    errorMessage: null,
    createdAt: hoursAgo(5), appliedAt: null,
  },

  {
    id: 'act-t05',
    campaignId: 'cmp-001', campaignName: 'Ramadan Performance — Riyadh',
    adSetId: 'ads-001b', adSetName: 'Lookalike — Top 5% Purchasers',
    entityType: 'AD_SET', platform: 'META',
    actionType: 'ADJUST_BID_FLOOR', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'Low Frequency — Bid Support',
    before: { bid_floor_sar: null },
    after:  { bid_floor_sar: 3.5 },
    explanation: {
      en: 'This ad set was winning fewer auctions than expected at its current bid range. Setting a SAR 3.50 bid floor prevents the platform from bidding below a viable CPM threshold, which should improve delivery consistency without significantly raising costs.',
      ar: null,
    },
    errorMessage: null,
    createdAt: hoursAgo(7.1), appliedAt: hoursAgo(7.0),
  },

  // ── Yesterday ──────────────────────────────────────────────────────────────

  {
    id: 'act-y01',
    campaignId: 'cmp-001', campaignName: 'Ramadan Performance — Riyadh',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'META',
    actionType: 'INCREASE_BUDGET', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'High ROAS — Budget Scale',
    before: { daily_budget_sar: 2300 },
    after:  { daily_budget_sar: 2600 },
    explanation: {
      en: 'ROAS maintained above 3.8x for 3 consecutive 24-hour windows with spend pacing at 94%. Budget scaled from SAR 2,300 to SAR 2,600 (+13.0%) to continue capturing high-intent conversions at this efficiency.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(1, 2), appliedAt: daysAgo(1, 1.9),
  },

  {
    id: 'act-y02',
    campaignId: 'cmp-005', campaignName: 'Snapchat Discover — Jeddah',
    adSetId: 'ads-005a', adSetName: 'Top of Funnel — 18-34 Jeddah',
    entityType: 'AD_SET', platform: 'SNAPCHAT',
    actionType: 'DECREASE_BUDGET', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'Degraded ROAS — Budget Cut',
    before: { daily_budget_sar: 300 },
    after:  { daily_budget_sar: 180 },
    explanation: {
      en: 'ROAS fell to 0.8x — below the 1.0x unprofitability threshold — for 3 consecutive windows. Daily budget reduced by 40% from SAR 300 to SAR 180 to limit losses while a root-cause review is performed.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(1, 4), appliedAt: daysAgo(1, 3.9),
  },

  {
    id: 'act-y03',
    campaignId: 'cmp-003', campaignName: 'Retargeting — Checkout Abandonment',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'META',
    actionType: 'INCREASE_BUDGET', status: 'FAILED', triggeredBy: 'SCHEDULER',
    ruleName: 'High ROAS — Budget Scale',
    before: { daily_budget_sar: 700 },
    after:  { daily_budget_sar: 800 },
    explanation: {
      en: 'ROAS at 5.2x with 96% pacing — budget increase recommended. However, the Meta API returned an account-level error preventing the update. No budget change was made. The system will retry on the next cycle.',
      ar: null,
    },
    errorMessage: 'Meta API error: (#200) Requires ads_management permission — token may need re-authorization.',
    createdAt: daysAgo(1, 6), appliedAt: null,
  },

  {
    id: 'act-y04',
    campaignId: 'cmp-002', campaignName: 'Brand Awareness Q2 — KSA',
    adSetId: 'ads-002b', adSetName: 'Retargeting — Engaged Viewers 30s',
    entityType: 'AD_SET', platform: 'TIKTOK',
    actionType: 'ADJUST_BID_CEILING', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'Underspend — Bid Ceiling Lift',
    before: { bid_ceiling_sar: 10.0 },
    after:  { bid_ceiling_sar: 13.0 },
    explanation: {
      en: 'Ad set spent only 61% of its daily budget with 0 delivery issues flagged. The bid ceiling of SAR 10.00 was too restrictive — TikTok\'s auction clearing price exceeded it in most slots. Ceiling raised to SAR 13.00 to increase auction win rate.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(1, 9), appliedAt: daysAgo(1, 8.9),
  },

  {
    id: 'act-y05',
    campaignId: 'cmp-004', campaignName: 'Google Search — High Intent',
    adSetId: 'ads-004a', adSetName: 'Branded Keywords — Exact Match',
    entityType: 'AD_SET', platform: 'GOOGLE_ADS',
    actionType: 'SWITCH_BIDDING_STRATEGY', status: 'ROLLED_BACK', triggeredBy: 'SCHEDULER',
    ruleName: 'Low Impression Share — Aggressive Bidding',
    before: { bidding_strategy: 'TARGET_CPA', target_cpa_sar: 20.0 },
    after:  { bidding_strategy: 'LOWEST_COST' },
    explanation: {
      en: 'Switched from Target CPA to Lowest Cost to capture more volume during a period of high search intent. The change resulted in CPA spiking 80% within 4 hours — above the emergency rollback threshold. Strategy was reverted to Target CPA automatically.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(1, 12), appliedAt: daysAgo(1, 11.5),
  },

  // ── 2 days ago ─────────────────────────────────────────────────────────────

  {
    id: 'act-2d01',
    campaignId: 'cmp-001', campaignName: 'Ramadan Performance — Riyadh',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'META',
    actionType: 'INCREASE_BUDGET', status: 'APPLIED', triggeredBy: 'MANUAL',
    ruleName: null,
    before: { daily_budget_sar: 2000 },
    after:  { daily_budget_sar: 2300 },
    explanation: {
      en: 'Manual budget increase triggered by account manager. Campaign showed ROAS 3.9x with strong conversion volume. Budget raised from SAR 2,000 to SAR 2,300 ahead of peak Ramadan traffic hours.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(2, 3), appliedAt: daysAgo(2, 2.9),
  },

  {
    id: 'act-2d02',
    campaignId: 'cmp-005', campaignName: 'Snapchat Discover — Jeddah',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'SNAPCHAT',
    actionType: 'DECREASE_BUDGET', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'High CPA — Budget Throttle',
    before: { daily_budget_sar: 600 },
    after:  { daily_budget_sar: 300 },
    explanation: {
      en: 'CPA reached SAR 38.90 — 77% above the SAR 22.00 target — for 3 consecutive evaluation windows. Budget halved from SAR 600 to SAR 300 to reduce losses while the campaign is under review. Optimizer mode will escalate to DEGRADED.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(2, 6), appliedAt: daysAgo(2, 5.9),
  },

  {
    id: 'act-2d03',
    campaignId: 'cmp-002', campaignName: 'Brand Awareness Q2 — KSA',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'TIKTOK',
    actionType: 'INCREASE_BUDGET', status: 'SKIPPED', triggeredBy: 'SCHEDULER',
    ruleName: 'High ROAS — Budget Scale',
    before: { daily_budget_sar: 1500 },
    after:  { daily_budget_sar: 1725 },
    explanation: {
      en: 'Budget increase was proposed based on strong ROAS, but a cooldown is active from the strategy change applied 18 hours earlier. No action taken — the cooldown window is 24 hours. This rule will be re-evaluated in the next cycle.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(2, 9), appliedAt: null,
  },

  {
    id: 'act-2d04',
    campaignId: 'cmp-003', campaignName: 'Retargeting — Checkout Abandonment',
    adSetId: 'ads-003a', adSetName: 'Warm Audience — 7-day visitors',
    entityType: 'AD_SET', platform: 'META',
    actionType: 'ADJUST_BID_FLOOR', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'Underspend — Bid Floor Removal',
    before: { bid_floor_sar: 5.0 },
    after:  { bid_floor_sar: null },
    explanation: {
      en: 'Bid floor of SAR 5.00 was preventing this ad set from competing in lower-CPM inventory slots where conversion rates are strong. Removing the floor expands the accessible auction pool and should improve spend efficiency.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(2, 14), appliedAt: daysAgo(2, 13.9),
  },

  // ── 3 days ago ─────────────────────────────────────────────────────────────

  {
    id: 'act-3d01',
    campaignId: 'cmp-001', campaignName: 'Ramadan Performance — Riyadh',
    adSetId: 'ads-001a', adSetName: 'Core Audience — Purchase Intent KSA',
    entityType: 'AD_SET', platform: 'META',
    actionType: 'SWITCH_BIDDING_STRATEGY', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'Strong ROAS — Strategy Upgrade',
    before: { bidding_strategy: 'COST_CAP', cost_cap_sar: 15.0 },
    after:  { bidding_strategy: 'LOWEST_COST' },
    explanation: {
      en: 'ROAS sustained above 4.0x for 3 consecutive windows while Cost Cap was active. Removing the cap and switching to Lowest Cost gives the platform more flexibility to bid aggressively on high-intent users, which should increase conversion volume at this efficiency level.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(3, 4), appliedAt: daysAgo(3, 3.9),
  },

  {
    id: 'act-3d02',
    campaignId: 'cmp-004', campaignName: 'Google Search — High Intent',
    adSetId: null, adSetName: null, entityType: 'CAMPAIGN', platform: 'GOOGLE_ADS',
    actionType: 'DECREASE_BUDGET', status: 'APPLIED', triggeredBy: 'SCHEDULER',
    ruleName: 'Low CTR — Spend Reduction',
    before: { daily_budget_sar: 2500 },
    after:  { daily_budget_sar: 2000 },
    explanation: {
      en: 'CTR dropped to 1.4% — below the 2.0% threshold — for 2 consecutive windows, suggesting keyword-audience alignment issues. Budget reduced by 20% to SAR 2,000 to limit wasted spend while the keyword list is reviewed.',
      ar: null,
    },
    errorMessage: null,
    createdAt: daysAgo(3, 8), appliedAt: daysAgo(3, 7.9),
  },
];

// ─── Unique campaign list for filter dropdown ─────────────────────────────────

export const UNIQUE_CAMPAIGNS = Array.from(
  new Map(MOCK_ACTIONS.map((a) => [a.campaignId, { id: a.campaignId, name: a.campaignName }])).values(),
);
