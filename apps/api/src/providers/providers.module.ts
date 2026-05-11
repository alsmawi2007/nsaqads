import { Module } from '@nestjs/common';
import { MockProvider } from './mock/mock.provider';
import { ProviderFactory } from './factory/provider.factory';
import { MetaModule } from './meta/meta.module';
import { GoogleAdsModule } from './google-ads/google-ads.module';
import { SnapchatModule } from './snapchat/snapchat.module';
import { TikTokModule } from './tiktok/tiktok.module';
import { AdAccountLoader } from './shared/ad-account.loader';
import { PrismaModule } from '../prisma/prisma.module';

// ProvidersModule is the public surface — every other module imports this
// (and only this) when it needs IAdProvider.
@Module({
  imports: [PrismaModule, MetaModule, GoogleAdsModule, SnapchatModule, TikTokModule],
  providers: [MockProvider, AdAccountLoader, ProviderFactory],
  exports: [ProviderFactory, AdAccountLoader],
})
export class ProvidersModule {}
