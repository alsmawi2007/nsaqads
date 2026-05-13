import { api } from './client';
import type { ProviderPlatform } from './provider-configs';

export interface AdAccount {
  id:              string;
  orgId:           string;
  platform:        ProviderPlatform;
  externalId:      string;
  name:            string | null;
  currency:        string | null;
  timezone:        string | null;
  status:          'ACTIVE' | 'INACTIVE' | 'ERROR' | 'EXPIRED' | 'MOCK';
  errorMessage:    string | null;
  tokenExpiresAt:  string | null;
  createdAt:       string;
  updatedAt:       string;
}

export interface AdAccountHealth {
  status:         'OK' | 'ERROR' | 'EXPIRED';
  tokenExpiresAt: string | null;
  message?:       string;
}

export interface SyncResult {
  campaignsSynced: number;
  adSetsSynced:    number;
}

export const adAccountsApi = {
  list: (orgId: string): Promise<AdAccount[]> =>
    api.get<AdAccount[]>(`/orgs/${orgId}/ad-accounts`),

  get: (orgId: string, accountId: string): Promise<AdAccount> =>
    api.get<AdAccount>(`/orgs/${orgId}/ad-accounts/${accountId}`),

  disconnect: (orgId: string, accountId: string): Promise<void> =>
    api.delete<void>(`/orgs/${orgId}/ad-accounts/${accountId}`),

  health: (orgId: string, accountId: string): Promise<AdAccountHealth> =>
    api.get<AdAccountHealth>(`/orgs/${orgId}/ad-accounts/${accountId}/health`),

  sync: (orgId: string, accountId: string): Promise<SyncResult> =>
    api.post<SyncResult>(`/orgs/${orgId}/ad-accounts/${accountId}/sync`),
};
