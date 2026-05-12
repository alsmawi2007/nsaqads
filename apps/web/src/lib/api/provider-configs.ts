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

// Mapping of ProviderPlatform → URL segment used by the API's provider OAuth
// controllers. Snap, Meta, TikTok use the lowercased platform name; Google Ads
// uses a kebab-cased path.
const OAUTH_PATH_SEGMENT: Record<ProviderPlatform, string> = {
  META:       'meta',
  GOOGLE_ADS: 'google-ads',
  SNAPCHAT:   'snapchat',
  TIKTOK:     'tiktok',
  TWITTER:    'twitter',
};

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

  // Build the platform's OAuth authorize URL for a given org. The frontend
  // navigates the user to the returned `url`; the platform redirects back
  // to our callback which then redirects back to the providers page with a
  // status query.
  oauthStart: (
    orgId: string,
    platform: ProviderPlatform,
  ): Promise<{ url: string }> =>
    api.get<{ url: string }>(
      `/orgs/${orgId}/providers/${OAUTH_PATH_SEGMENT[platform]}/oauth/start`,
    ),
};
