/**
 * Mock data matching the backend schema exactly.
 * Replace each const with a React Query call to swap in live data.
 *
 * Types mirror:
 *   Campaign / MetricSnapshot  → src/lib/api/campaigns.ts
 *   OptimizerAction            → src/lib/api/optimizer.ts
 *   Alert                      → src/lib/api/alerts.ts
 */

import type { CampaignPhase, CampaignStatus, OptimizerMode, Platform } from '@/lib/api/campaigns';
import type { ActionStatus, ActionType, TriggeredBy } from '@/lib/api/optimizer';
import type { AlertSeverity, AlertType } from '@/lib/api/alerts';

// ─── Aggregate KPIs ───────────────────────────────────────────────────────────

export interface DashboardKPIs {
  totalSpend: number;
  totalConversions: number;
  avgRoas: number;
  avgCpa: number;
  avgCtr: number;          // ratio, 0–1
  trends: {
    spend: number;         // % change vs yesterday (positive = up)
    conversions: number;
    roas: number;
    cpa: number;           // for CPA, negative trend = good (lower cost)
    ctr: number;
  };
}

export const MOCK_KPIS: DashboardKPIs = {
  totalSpend:       24_580,
  totalConversions: 1_984,
  avgRoas:          3.24,
  avgCpa:           12.39,
  avgCtr:           0.0241,
  trends: {
    spend:       8.3,
    conversions: 11.7,
    roas:        6.2,
    cpa:         -4.1,   // negative = cost went down = good
    ctr:         2.8,
  },
};

// ─── Dashboard Campaign Row ────────────────────────────────────────────────────

export interface DashboardCampaign {
  id: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  campaignPhase: CampaignPhase;
  optimizerMode: OptimizerMode;
  dailyBudget: number;
  metrics: {
    spend: number;
    roas: number;
    cpa: number;
    ctr: number;           // ratio
    conversions: number;
    spendPacing: number;   // ratio 0–1
  };
}

export const MOCK_CAMPAIGNS: DashboardCampaign[] = [
  {
    id: 'cmp-001',
    name: 'Ramadan Performance — Riyadh',
    platform: 'META',
    status: 'ACTIVE',
    campaignPhase: 'SCALING',
    optimizerMode: 'AUTO_APPLY',
    dailyBudget: 3_000,
    metrics: { spend: 2_840, roas: 4.12, cpa: 9.80, ctr: 0.031, conversions: 289, spendPacing: 0.95 },
  },
  {
    id: 'cmp-002',
    name: 'Brand Awareness Q2 — KSA',
    platform: 'TIKTOK',
    status: 'ACTIVE',
    campaignPhase: 'STABLE',
    optimizerMode: 'AUTO_APPLY',
    dailyBudget: 1_500,
    metrics: { spend: 1_102, roas: 2.87, cpa: 14.20, ctr: 0.022, conversions: 77, spendPacing: 0.73 },
  },
  {
    id: 'cmp-003',
    name: 'Retargeting — Checkout Abandonment',
    platform: 'META',
    status: 'ACTIVE',
    campaignPhase: 'STABLE',
    optimizerMode: 'SUGGEST_ONLY',
    dailyBudget: 800,
    metrics: { spend: 788, roas: 5.60, cpa: 7.10, ctr: 0.048, conversions: 111, spendPacing: 0.99 },
  },
  {
    id: 'cmp-004',
    name: 'Google Search — High Intent',
    platform: 'GOOGLE_ADS',
    status: 'ACTIVE',
    campaignPhase: 'LEARNING',
    optimizerMode: 'SUGGEST_ONLY',
    dailyBudget: 2_000,
    metrics: { spend: 820, roas: 1.90, cpa: 22.40, ctr: 0.018, conversions: 36, spendPacing: 0.41 },
  },
  {
    id: 'cmp-005',
    name: 'Snapchat Discover — Jeddah',
    platform: 'SNAPCHAT',
    status: 'PAUSED',
    campaignPhase: 'DEGRADED',
    optimizerMode: 'OFF',
    dailyBudget: 600,
    metrics: { spend: 0, roas: 0.80, cpa: 38.90, ctr: 0.009, conversions: 4, spendPacing: 0 },
  },
];

// ─── Optimizer Summary ─────────────────────────────────────────────────────────

export interface OptimizerTodaySummary {
  applied: number;
  pending: number;
  failed: number;
  skipped: number;
}

export interface DashboardOptimizerAction {
  id: string;
  campaignName: string;
  actionType: ActionType;
  status: ActionStatus;
  triggeredBy: TriggeredBy;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  explanation: { en: string; ar: string | null };
  createdAt: string;
}

export const MOCK_OPTIMIZER_TODAY: OptimizerTodaySummary = {
  applied: 9,
  pending: 3,
  failed: 1,
  skipped: 2,
};

export const MOCK_OPTIMIZER_ACTIONS: DashboardOptimizerAction[] = [
  {
    id: 'act-001',
    campaignName: 'Ramadan Performance — Riyadh',
    actionType: 'INCREASE_BUDGET',
    status: 'APPLIED',
    triggeredBy: 'SCHEDULER',
    before: { daily_budget: 2600 },
    after:  { daily_budget: 3000 },
    explanation: {
      en: 'ROAS was 4.1x (target: 3.0x) for 3 consecutive 24h windows. Daily budget increased +15% from SAR 2,600 to SAR 3,000.',
      ar: null,
    },
    createdAt: new Date(Date.now() - 14 * 60_000).toISOString(),
  },
  {
    id: 'act-002',
    campaignName: 'Brand Awareness Q2 — KSA',
    actionType: 'SWITCH_BIDDING_STRATEGY',
    status: 'APPLIED',
    triggeredBy: 'SCHEDULER',
    before: { bidding_strategy: 'LOWEST_COST' },
    after:  { bidding_strategy: 'COST_CAP', bid_amount: 18 },
    explanation: {
      en: 'CPA exceeded target threshold (SAR 14.20 vs target SAR 12.00) for 2 consecutive windows. Switched to Cost Cap bidding.',
      ar: null,
    },
    createdAt: new Date(Date.now() - 72 * 60_000).toISOString(),
  },
  {
    id: 'act-003',
    campaignName: 'Retargeting — Checkout Abandonment',
    actionType: 'INCREASE_BUDGET',
    status: 'PENDING',
    triggeredBy: 'SCHEDULER',
    before: { daily_budget: 700 },
    after:  { daily_budget: 800 },
    explanation: {
      en: 'Spend pacing at 99% with ROAS 5.6x. Budget increase recommended pending human approval.',
      ar: null,
    },
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    id: 'act-004',
    campaignName: 'Google Search — High Intent',
    actionType: 'ADJUST_BID_CEILING',
    status: 'SKIPPED',
    triggeredBy: 'SCHEDULER',
    before: { bid_ceiling: null },
    after:  { bid_ceiling: 5.0 },
    explanation: {
      en: 'Campaign in LEARNING phase — action skipped. Optimizer will re-evaluate after learning phase completes.',
      ar: null,
    },
    createdAt: new Date(Date.now() - 130 * 60_000).toISOString(),
  },
];

// ─── Alerts ────────────────────────────────────────────────────────────────────

export interface DashboardAlert {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  campaignName: string | null;
  isRead: boolean;
  createdAt: string;
}

export const MOCK_ALERTS: DashboardAlert[] = [
  {
    id: 'alrt-001',
    alertType: 'BUDGET_EXHAUSTED',
    severity: 'CRITICAL',
    message: 'Daily budget fully spent with 6 hours remaining in the day. No further delivery until tomorrow.',
    campaignName: 'Ramadan Performance — Riyadh',
    isRead: false,
    createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  },
  {
    id: 'alrt-002',
    alertType: 'HIGH_CPA',
    severity: 'WARNING',
    message: 'CPA exceeded target by 78% (SAR 38.90 vs target SAR 22.00) for 2 consecutive windows.',
    campaignName: 'Snapchat Discover — Jeddah',
    isRead: false,
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: 'alrt-003',
    alertType: 'LEARNING_STALLED',
    severity: 'WARNING',
    message: 'Campaign has been in LEARNING phase for 9 days with insufficient conversion volume.',
    campaignName: 'Google Search — High Intent',
    isRead: true,
    createdAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
  },
  {
    id: 'alrt-004',
    alertType: 'LOW_ROAS',
    severity: 'INFO',
    message: 'ROAS dropped below 1.0x threshold. Campaign is currently unprofitable.',
    campaignName: 'Snapchat Discover — Jeddah',
    isRead: true,
    createdAt: new Date(Date.now() - 10 * 3_600_000).toISOString(),
  },
];
