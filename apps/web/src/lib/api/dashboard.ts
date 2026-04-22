import { api } from './client';
import type { Platform, CampaignPhase, CampaignStatus, OptimizerMode } from './campaigns';
import type { ActionType, ActionStatus, TriggeredBy } from './optimizer';
import type { AlertType, AlertSeverity } from './alerts';

export interface DashboardKPIs {
  totalSpend: number;
  totalConversions: number;
  avgRoas: number;
  avgCpa: number;
  avgCtr: number;
  activeCampaigns: number;
}

export interface DashboardCampaign {
  id: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  campaignPhase: CampaignPhase;
  optimizerMode: OptimizerMode;
  dailyBudget: number | null;
  metrics: {
    spend: number;
    roas: number;
    cpa: number;
    ctr: number;
    conversions: number;
    spendPacing: number;
  };
}

export interface DashboardOptimizerToday {
  applied: number;
  pending: number;
  failed: number;
  skipped: number;
}

export interface DashboardAlert {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  entityType: string;
  isRead: boolean;
  campaignName: string | null;
  createdAt: string;
}

export interface DashboardAction {
  id: string;
  actionType: ActionType;
  status: ActionStatus;
  triggeredBy: TriggeredBy;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  explanation: { en: string; ar: string | null };
  campaignName: string;
  createdAt: string;
}

export interface DashboardSummary {
  kpis: DashboardKPIs;
  campaigns: DashboardCampaign[];
  optimizerToday: DashboardOptimizerToday;
  recentActions: DashboardAction[];
  recentAlerts: DashboardAlert[];
  generatedAt: string;
}

export const dashboardApi = {
  getSummary: (orgId: string) =>
    api.get<DashboardSummary>(`/orgs/${orgId}/dashboard`),
};
