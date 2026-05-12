import { api } from './client';

export type ProviderPlatform = 'META' | 'GOOGLE_ADS' | 'SNAPCHAT' | 'TIKTOK' | 'TWITTER';

export interface RedactedProviderConfig {
  platform: ProviderPlatform;
  isEnabled: boolean;
  appId: string;
  redirectUri: string;
  apiVersion: string | null;
  scopes: string[];
  extra: Record<string, unknown> | null;
  hasAppSecret: boolean;
  hasOauthStateSecret: boolean;
  appSecretLast4: string | null;
  oauthStateSecretLast4: string | null;
  extraSecretKeys: string[];
  keyVersion: number;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProviderConfigPayload {
  isEnabled?: boolean;
  appId: string;
  appSecret?: string;
  redirectUri: string;
  oauthStateSecret?: string;
  apiVersion?: string;
  scopes?: string[];
  extra?: Record<string, unknown>;
  extraSecrets?: Record<string, string>;
}

export const providerConfigsApi = {
  list: (): Promise<RedactedProviderConfig[]> =>
    api.get<RedactedProviderConfig[]>('/admin/provider-configs'),

  get: (platform: ProviderPlatform): Promise<RedactedProviderConfig | null> =>
    api.get<RedactedProviderConfig | null>(`/admin/provider-configs/${platform}`),

  upsert: (
    platform: ProviderPlatform,
    payload: UpsertProviderConfigPayload,
  ): Promise<RedactedProviderConfig> =>
    api.put<RedactedProviderConfig>(`/admin/provider-configs/${platform}`, payload),

  setEnabled: (
    platform: ProviderPlatform,
    isEnabled: boolean,
  ): Promise<RedactedProviderConfig> =>
    api.patch<RedactedProviderConfig>(
      `/admin/provider-configs/${platform}/enabled`,
      { isEnabled },
    ),

  remove: (platform: ProviderPlatform): Promise<void> =>
    api.delete<void>(`/admin/provider-configs/${platform}`),
};
