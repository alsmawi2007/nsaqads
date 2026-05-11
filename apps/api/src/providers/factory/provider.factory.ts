import { Injectable } from '@nestjs/common';
import { IAdProvider, Platform } from '../interfaces/ad-provider.interface';
import { MetaProvider } from '../meta/meta.provider';
import { GoogleAdsProvider } from '../google-ads/google-ads.provider';
import { SnapchatProvider } from '../snapchat/snapchat.provider';
import { TikTokProvider } from '../tiktok/tiktok.provider';

// ProviderFactory is the ONLY place in the codebase that references concrete
// provider classes. All other code receives IAdProvider through this factory.
//
// Routing:
//   META        → MetaProvider       (real Meta Graph API)
//   GOOGLE_ADS  → GoogleAdsProvider  (real Google Ads REST API)
//   SNAPCHAT    → SnapchatProvider   (real Snap Marketing API)
//   TIKTOK      → TikTokProvider     (real TikTok Marketing API)
//
// Every concrete provider falls back to MockProvider internally when its
// AdAccount has status === 'MOCK', so callers do not need to choose between
// real and mock at the factory level.
//
// Note: TWITTER is a valid Prisma Platform (so ProviderConfig rows can be
// stored) but intentionally absent from IAdProvider's Platform string union
// until a real provider implementation lands. getProvider('TWITTER') would
// throw at runtime; the factory's typed signature prevents callers from
// reaching that path.
@Injectable()
export class ProviderFactory {
  private readonly providers = new Map<Platform, IAdProvider>();

  constructor(
    metaProvider: MetaProvider,
    googleAdsProvider: GoogleAdsProvider,
    snapchatProvider: SnapchatProvider,
    tiktokProvider: TikTokProvider,
  ) {
    this.providers.set('META', metaProvider);
    this.providers.set('GOOGLE_ADS', googleAdsProvider);
    this.providers.set('SNAPCHAT', snapchatProvider);
    this.providers.set('TIKTOK', tiktokProvider);
  }

  getProvider(platform: Platform): IAdProvider {
    const provider = this.providers.get(platform);
    if (!provider) throw new Error(`No provider registered for platform: ${platform}`);
    return provider;
  }
}
