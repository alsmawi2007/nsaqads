import type { AdAccount } from '@prisma/client';
import type { Platform } from './ad-provider.interface';

// Structured replacement for the old `adAccountId: string` parameter.
// Carrying both ids removes the UUID-vs-externalId ambiguity that older
// callsites encoded by convention. Callers always know both, so passing
// both is cheap; providers pick whichever they need:
//   - DB-side ops (token decrypt, status check)  → use `id`
//   - Platform API URLs                          → use `externalId`
// This struct is the ONLY thing that should ever be passed to IAdProvider
// methods to identify an ad account.
export interface AdAccountRef {
  id:         string;     // Nasaq Ads DB UUID
  externalId: string;     // platform-side id (e.g. Meta 'act_<n>', Google '<customer_id>')
  platform:   Platform;
}

export function refFromAccount(account: AdAccount): AdAccountRef {
  return {
    id:         account.id,
    externalId: account.externalId,
    platform:   account.platform as Platform,
  };
}
