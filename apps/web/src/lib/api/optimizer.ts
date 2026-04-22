import { api } from './client';
import type { Platform } from './campaigns';

export type ActionStatus = 'PENDING' | 'APPLIED' | 'FAILED' | 'SKIPPED' | 'ROLLED_BACK';
export type ActionType =
  | 'INCREASE_BUDGET'
  | 'DECREASE_BUDGET'
  | 'SWITCH_BIDDING_STRATEGY'
  | 'ADJUST_BID_CEILING'
  | 'ADJUST_BID_FLOOR';
export type TriggeredBy = 'SCHEDULER' | 'MANUAL' | 'API';

export interface OptimizerAction {
  id: string;
  orgId: string;
  ruleId: string | null;
  entityType: 'CAMPAIGN' | 'AD_SET';
  entityId: string;
  platform: Platform;
  actionType: ActionType;
  beforeValue: Record<string, unknown>;
  afterValue: Record<string, unknown>;
  status: ActionStatus;
  appliedAt: string | null;
  errorMessage: string | null;
  triggeredBy: TriggeredBy;
  triggeredByUserId: string | null;
  evaluationContext: Record<string, unknown> | null;
  explanation: { en: string; ar: string | null };
  createdAt: string;
  rule?: { id: string; name: string } | null;
  // Enriched fields returned by listActions
  campaignId: string;
  campaignName: string;
  adSetId: string | null;
  adSetName: string | null;
  ruleName: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface OptimizerRule {
  id: string;
  orgId: string | null;
  ruleFamily: 'BUDGET' | 'BIDDING_STRATEGY' | 'BID_LIMIT';
  name: string;
  description: string | null;
  isEnabled: boolean;
  priority: number;
  kpiMetric: string;
  comparator: 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ';
  thresholdValue: string;
  actionType: ActionType;
  actionDelta: string | null;
  actionTargetValue: string | null;
}

export interface CooldownTracker {
  id: string;
  entityType: string;
  entityId: string;
  actionType: string;
  expiresAt: string;
  cooldownHours: number;
}

export interface CycleResult {
  orgId: string;
  entitiesEvaluated: number;
  actionsApplied: number;
  actionsPending: number;
  actionsSkipped: number;
  actionsFailed: number;
  durationMs: number;
}

// Simulation types — mirrors SimulatedAction in mock-simulation.ts but from the API
export interface SimulatedImpact {
  metric: string;
  before: string;
  after: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface SimulateResult {
  readonly isSimulated: true;
  id: string;
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
  simulatedAt: string;
}

export const optimizerApi = {
  listActions: (
    orgId: string,
    params?: { entityId?: string; status?: string; cursor?: string; limit?: number },
  ) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : '';
    return api.get<OptimizerAction[]>(`/orgs/${orgId}/optimizer/actions${qs}`);
  },

  getAction: (orgId: string, actionId: string) =>
    api.get<OptimizerAction>(`/orgs/${orgId}/optimizer/actions/${actionId}`),

  approveAction: (orgId: string, actionId: string) =>
    api.post(`/orgs/${orgId}/optimizer/actions/${actionId}/approve`),

  rejectAction: (orgId: string, actionId: string) =>
    api.post(`/orgs/${orgId}/optimizer/actions/${actionId}/reject`),

  runCycle: (orgId: string) =>
    api.post<CycleResult>(`/orgs/${orgId}/optimizer/run`),

  // Simulate runs the full evaluation+guardrail pipeline but does NOT persist anything.
  // Returns projected actions with estimated impact.
  // POST so the backend can accept optional simulation parameters in future.
  simulate: (orgId: string) =>
    api.post<SimulateResult[]>(`/orgs/${orgId}/optimizer/simulate`),

  listRules: (orgId: string) =>
    api.get<{ orgRules: OptimizerRule[]; globalRules: OptimizerRule[] }>(
      `/orgs/${orgId}/optimizer/rules`,
    ),

  getCooldowns: (orgId: string) =>
    api.get<CooldownTracker[]>(`/orgs/${orgId}/optimizer/cooldowns`),

  listCooldowns: (orgId: string) =>
    api.get<CooldownTracker[]>(`/orgs/${orgId}/optimizer/cooldowns`),
};
