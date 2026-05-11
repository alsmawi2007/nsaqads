import { Platform } from '@prisma/client';

// Decrypted, ready-to-use config returned by ProviderConfigService.getEnabled().
// Plaintext secrets — never log, never serialize, never return via HTTP.
export interface ResolvedProviderConfig {
  platform:         Platform;
  isEnabled:        boolean;
  appId:            string;
  appSecret:        string;
  redirectUri:      string;
  oauthStateSecret: string;
  apiVersion:       string | null;
  scopes:           string[];
  extra:            Record<string, unknown> | null;
  // Decrypted bag of platform-specific sensitive credentials (e.g. Google
  // Ads developerToken). null if none configured.
  extraSecrets:     Record<string, string> | null;
}

// Safe-to-return shape for admin GET endpoints. Secrets are replaced by
// presence flags + last-4 fingerprints; never includes plaintext.
export interface RedactedProviderConfig {
  platform:                Platform;
  isEnabled:               boolean;
  appId:                   string;
  redirectUri:             string;
  apiVersion:              string | null;
  scopes:                  string[];
  extra:                   Record<string, unknown> | null;
  hasAppSecret:            boolean;
  hasOauthStateSecret:     boolean;
  appSecretLast4:          string | null;
  oauthStateSecretLast4:   string | null;
  // List of keys present in the encrypted extras bag. Values never leave
  // the server; admin UI shows "set" / "not set" per key.
  extraSecretKeys:         string[];
  keyVersion:              number;
  updatedById:             string | null;
  updatedAt:               string;
  createdAt:               string;
}
