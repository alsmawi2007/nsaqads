import { api } from '@/lib/api/client';
import type {
  CampaignPlanStatus,
  LaunchResult,
  PlanResponse,
  Platform,
  WizardInput,
} from './types';

export interface AdAccountSummary {
  id: string;
  platform: Platform;
  externalId: string;
  name: string | null;
  currency: string | null;
  status: string;
}

export const campaignArchitectApi = {
  createPlan: (orgId: string, input: WizardInput) =>
    api.post<PlanResponse>(`/orgs/${orgId}/campaign-plans`, input),

  listPlans: (orgId: string, params?: { status?: CampaignPlanStatus; limit?: number }) => {
    const qs = params
      ? '?' +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : '';
    return api.get<PlanResponse[]>(`/orgs/${orgId}/campaign-plans${qs}`);
  },

  getPlan: (orgId: string, planId: string) =>
    api.get<PlanResponse>(`/orgs/${orgId}/campaign-plans/${planId}`),

  regeneratePlan: (orgId: string, planId: string) =>
    api.post<PlanResponse>(`/orgs/${orgId}/campaign-plans/${planId}/regenerate`),

  approvePlan: (orgId: string, planId: string, acknowledgedWarnings: boolean) =>
    api.post<PlanResponse>(`/orgs/${orgId}/campaign-plans/${planId}/approve`, {
      acknowledgedWarnings,
    }),

  launchPlan: (orgId: string, planId: string) =>
    api.post<LaunchResult>(`/orgs/${orgId}/campaign-plans/${planId}/launch`),

  listAdAccounts: (orgId: string) =>
    api.get<AdAccountSummary[]>(`/orgs/${orgId}/ad-accounts`),
};
