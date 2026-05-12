import type { ProviderPlatform } from '@/lib/api/provider-configs';

// Per-platform metadata for the admin UI:
//   - displayName    — what the human sees
//   - apiVersion     — sensible default to prefill in the form
//   - defaultScopes  — preselected OAuth scopes (some platforms use app-level
//                      scopes and want an empty list)
//   - extraSecretKeys / extraKeys — schema for the "Advanced" section. Lets
//                      the form render fields instead of a raw-JSON textarea.
//   - callbackPath   — the API route the platform redirects to after OAuth.
//                      The page combines this with PUBLIC_API_BASE_URL to
//                      show the exact URL the admin must whitelist in the
//                      platform's developer console.
//   - docsUrl        — where the admin can grab the credentials from.

export interface PlatformMeta {
  platform:         ProviderPlatform;
  displayName:      string;
  brandHex:         string;
  apiVersion:       string;
  defaultScopes:    string[];
  extraKeys:        Array<{ key: string; label: string; hint?: string }>;
  extraSecretKeys:  Array<{ key: string; label: string; hint?: string }>;
  callbackPath:     string;
  docsUrl:          string;
  notes?:           string;
  implemented:      boolean;
  // True when the API's OAuth callback redirects back to the web app's
  // /settings/providers page with a status query. When false, clicking
  // Connect would land the user on a raw JSON response from the callback.
  redirectCallbackWired: boolean;
}

export const PLATFORM_META: Record<Exclude<ProviderPlatform, 'TWITTER'>, PlatformMeta> & { TWITTER: PlatformMeta } = {
  META: {
    platform:              'META',
    displayName:           'Meta (Facebook + Instagram)',
    brandHex:              '#1877F2',
    apiVersion:            'v21.0',
    defaultScopes:         ['ads_management', 'ads_read', 'business_management'],
    extraKeys:             [],
    extraSecretKeys:       [],
    callbackPath:          '/api/v1/providers/meta/oauth/callback',
    docsUrl:               'https://developers.facebook.com/apps',
    implemented:           true,
    redirectCallbackWired: false,
  },
  GOOGLE_ADS: {
    platform:              'GOOGLE_ADS',
    displayName:           'Google Ads',
    brandHex:              '#4285F4',
    apiVersion:            'v18',
    defaultScopes:         ['https://www.googleapis.com/auth/adwords'],
    extraKeys:             [
      { key: 'loginCustomerId', label: 'Login customer id (MCC)', hint: 'Optional. Dash-stripped 10-digit MCC manager account id.' },
    ],
    extraSecretKeys:       [
      { key: 'developerToken',  label: 'Developer token', hint: 'Required. From Google Ads Manager → API Center.' },
    ],
    callbackPath:          '/api/v1/providers/google-ads/oauth/callback',
    docsUrl:               'https://console.cloud.google.com/apis/credentials',
    implemented:           true,
    redirectCallbackWired: false,
  },
  SNAPCHAT: {
    platform:              'SNAPCHAT',
    displayName:           'Snapchat Ads',
    brandHex:              '#FFFC00',
    apiVersion:            'v1',
    defaultScopes:         ['snapchat-marketing-api'],
    extraKeys:             [],
    extraSecretKeys:       [],
    callbackPath:          '/api/v1/providers/snapchat/oauth/callback',
    docsUrl:               'https://business.snapchat.com/manage/developers',
    implemented:           true,
    redirectCallbackWired: true,
  },
  TIKTOK: {
    platform:              'TIKTOK',
    displayName:           'TikTok Ads',
    brandHex:              '#000000',
    apiVersion:            'v1.3',
    defaultScopes:         [],
    extraKeys:             [],
    extraSecretKeys:       [],
    callbackPath:          '/api/v1/providers/tiktok/oauth/callback',
    docsUrl:               'https://business-api.tiktok.com',
    notes:                 'TikTok scopes are configured at the app level. Leave scopes empty here.',
    implemented:           true,
    redirectCallbackWired: false,
  },
  TWITTER: {
    platform:              'TWITTER',
    displayName:           'X (Twitter) Ads',
    brandHex:              '#000000',
    apiVersion:            'v12',
    defaultScopes:         [],
    extraKeys:             [],
    extraSecretKeys:       [],
    callbackPath:          '/api/v1/providers/twitter/oauth/callback',
    docsUrl:               'https://developer.twitter.com',
    notes:                 'The X provider implementation has not landed yet. Saving a config is supported, but OAuth will throw until a TwitterProvider class ships.',
    implemented:           false,
    redirectCallbackWired: false,
  },
};

export const PLATFORM_ORDER: ProviderPlatform[] = [
  'META',
  'GOOGLE_ADS',
  'SNAPCHAT',
  'TIKTOK',
  'TWITTER',
];

// PUBLIC_API_BASE_URL is the bootstrap env var the API uses to validate
// redirectUri on every PUT. We don't have it on the client, so we derive it
// from NEXT_PUBLIC_API_URL (which already points at the API). Falling back
// to the current origin keeps localhost dev working.
export function getApiBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    // strip trailing /api/v1 to recover the host root
    return apiUrl.replace(/\/api\/v1\/?$/, '');
  }
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function suggestRedirectUri(platform: ProviderPlatform): string {
  const meta = PLATFORM_META[platform];
  return `${getApiBaseUrl()}${meta.callbackPath}`;
}
