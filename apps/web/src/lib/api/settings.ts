import { api } from './client';

export interface OptimizerSettings {
  // Master control
  enabled: boolean;
  defaultMode: 'OFF' | 'SUGGEST_ONLY' | 'AUTO_APPLY';

  // Budget guardrails
  maxBudgetIncreasePct: number;   // e.g. 30 = max +30% per cycle
  maxBudgetDecreasePct: number;   // e.g. 20 = max -20% per cycle

  // Bid guardrails
  maxBidChangePct: number;        // e.g. 20 = max ±20% for any bid limit change

  // Performance thresholds (org-level defaults; campaigns can override)
  targetRoas: number | null;      // e.g. 3.0 — campaigns below trigger intervention
  targetCpa: number | null;       // e.g. 50.00 SAR — campaigns above trigger intervention
  minSampleImpressions: number;   // e.g. 1000 — no action below this threshold

  // Timing
  cooldownHours: number;          // e.g. 24 — min wait between actions on same entity
  cycleIntervalMinutes: number;   // e.g. 60 — how often the optimizer runs
}

export const SETTINGS_DEFAULTS: OptimizerSettings = {
  enabled: true,
  defaultMode: 'SUGGEST_ONLY',
  maxBudgetIncreasePct: 30,
  maxBudgetDecreasePct: 20,
  maxBidChangePct: 20,
  targetRoas: 3.0,
  targetCpa: null,
  minSampleImpressions: 1000,
  cooldownHours: 24,
  cycleIntervalMinutes: 60,
};

export const settingsApi = {
  getOptimizerSettings: (orgId: string): Promise<OptimizerSettings> =>
    api.get<OptimizerSettings>(`/orgs/${orgId}/settings/optimizer`),

  updateOptimizerSettings: (orgId: string, settings: OptimizerSettings): Promise<void> =>
    api.patch(`/orgs/${orgId}/settings/optimizer`, settings),
};
