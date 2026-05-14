import type { ConfigService } from '@nestjs/config';

// Maps the IAdProvider platform name to the URL segment the web app uses to
// describe the platform on /ad-accounts. Same values used by the web client.
const PLATFORM_QUERY = {
  META:       'meta',
  GOOGLE_ADS: 'google-ads',
  SNAPCHAT:   'snapchat',
  TIKTOK:     'tiktok',
} as const;
export type RedirectablePlatform = keyof typeof PLATFORM_QUERY;

// Resolve the web app's base URL for OAuth callback redirects.
//   - PUBLIC_WEB_APP_URL takes precedence (explicit, recommended in prod).
//   - Otherwise derive from PUBLIC_API_BASE_URL by replacing "api." with
//     "app." (matches our prod hostname convention: api.nsqads.ai → app.nsqads.ai).
//   - Localhost dev fallback: http://localhost:3001.
export function webAppBaseUrl(config: ConfigService): string {
  const explicit = config.get<string>('PUBLIC_WEB_APP_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const apiBase = config.get<string>('PUBLIC_API_BASE_URL');
  if (apiBase) return apiBase.replace(/\/$/, '').replace(/\/\/api\./, '//app.');
  return 'http://localhost:3001';
}

// /ad-accounts is the natural landing surface after OAuth — it lists the
// newly-connected ad account(s) and is reachable by every org member.
export function oauthSuccessRedirect(
  config: ConfigService,
  platform: RedirectablePlatform,
  accountsConnected: number,
): string {
  const base = webAppBaseUrl(config);
  return `${base}/ad-accounts?status=connected&platform=${PLATFORM_QUERY[platform]}&accounts=${accountsConnected}`;
}

export function oauthErrorRedirect(
  config: ConfigService,
  platform: RedirectablePlatform,
  message: string,
): string {
  const base = webAppBaseUrl(config);
  return `${base}/ad-accounts?status=error&platform=${PLATFORM_QUERY[platform]}&message=${encodeURIComponent(message)}`;
}
