import { api } from './client';
import type { ProviderPlatform } from './provider-configs';

export type ChecklistStatus = 'ok' | 'warn' | 'missing';

export interface ChecklistItem {
  status: ChecklistStatus;
  detail: string;
}

export interface ReadyChecklist {
  providerConnected:        ChecklistItem;
  adAccountTracked:         ChecklistItem;
  campaignsSynced:          ChecklistItem;
  activeCampaigns:          ChecklistItem;
  campaignPhaseEligible:    ChecklistItem;
  metricSnapshotsAvailable: ChecklistItem;
  optimizerRulesAvailable:  ChecklistItem;
  autoApplyDisabled:        ChecklistItem;
}

export interface ActivationLabStatus {
  orgId:       string;
  generatedAt: string;
  providers: Array<{ platform: ProviderPlatform; isConfigured: boolean; isEnabled: boolean }>;
  adAccounts: {
    total:     number;
    tracked:   number;
    available: number;
    perPlatform: Array<{ platform: ProviderPlatform; tracked: number; available: number }>;
  };
  campaigns: {
    total:                number;
    byStatus:             Record<string, number>;
    byPhase:              Record<string, number>;
    eligibleForOptimizer: number;
    activeAndEligible:    number;
  };
  adSets:    { total: number };
  ingestion: {
    snapshotsLast24h: number;
    lastRunAt:        string | null;
    lastRunSummary:   string | null;
  };
  optimizer: {
    ruleCount:        number;
    autoApplyEnabled: boolean;
    cooldownActive:   number;
  };
  ready: ReadyChecklist;
}

export interface IngestionRunResult {
  runId:        string;
  triggeredBy:  string;
  startedAt:    string;
  finishedAt:   string;
  successCount: number;
  failedCount:  number;
  skippedCount: number;
  durationMs:   number;
  entities?:    Array<{ entityType: string; entityId: string; status: string }>;
}

export const activationLabApi = {
  getStatus: (orgId: string): Promise<ActivationLabStatus> =>
    api.get<ActivationLabStatus>(`/orgs/${orgId}/activation-lab/status`),

  runIngestion: (orgId: string): Promise<IngestionRunResult> =>
    api.post<IngestionRunResult>(`/orgs/${orgId}/metrics/ingest/run`, {}),
};
