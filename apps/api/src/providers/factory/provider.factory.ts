import { Injectable } from '@nestjs/common';
import { IAdProvider, Platform } from '../interfaces/ad-provider.interface';
import { MockProvider } from '../mock/mock.provider';

// ProviderFactory is the ONLY place in the codebase that references concrete provider classes.
// All other code receives IAdProvider through this factory.
@Injectable()
export class ProviderFactory {
  private readonly providers = new Map<Platform, IAdProvider>();

  constructor(private mockProvider: MockProvider) {
    // In development or when real providers are not yet implemented,
    // all platforms resolve to MockProvider.
    const platforms: Platform[] = ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT'];
    platforms.forEach((p) => {
      const mock = Object.create(mockProvider) as MockProvider;
      (mock as { platform: Platform }).platform = p;
      this.providers.set(p, mock);
    });
  }

  getProvider(platform: Platform): IAdProvider {
    const provider = this.providers.get(platform);
    if (!provider) throw new Error(`No provider registered for platform: ${platform}`);
    return provider;
  }
}
