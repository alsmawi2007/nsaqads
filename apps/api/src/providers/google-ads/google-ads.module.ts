import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';
import { MockProvider } from '../mock/mock.provider';
import { AdAccountLoader } from '../shared/ad-account.loader';
import { NoopRateLimiter, RATE_LIMITER } from '../shared/rate-limiter';
import { GoogleAdsApiClient } from './google-ads-api.client';
import { GoogleAdsMapperService } from './google-ads-mapper.service';
import { GoogleAdsProvider } from './google-ads.provider';
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { GoogleAdsOAuthController } from './google-ads-oauth.controller';
import { GoogleAdsTokenService } from './google-ads-token.service';
import { GoogleAdsTokenScheduler } from './google-ads-token.scheduler';
import {
  DEFAULT_GOOGLE_ADS_CONVERSION_MAP,
  GOOGLE_ADS_CONVERSION_MAP,
} from './google-ads-conversion-config';

// All Google-Ads-specific wiring lives here. The outer ProvidersModule imports
// this module and consumes only GoogleAdsProvider via the factory.
@Module({
  imports: [PrismaModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [GoogleAdsOAuthController],
  providers: [
    MockProvider,           // re-provided so GoogleAdsProvider can compose it
    AdAccountLoader,
    { provide: RATE_LIMITER,              useClass: NoopRateLimiter },
    { provide: GOOGLE_ADS_CONVERSION_MAP, useValue: DEFAULT_GOOGLE_ADS_CONVERSION_MAP },
    GoogleAdsApiClient,
    GoogleAdsMapperService,
    GoogleAdsTokenService,
    GoogleAdsTokenScheduler,
    GoogleAdsOAuthService,
    GoogleAdsProvider,
  ],
  exports: [GoogleAdsProvider, MockProvider, AdAccountLoader, GoogleAdsTokenService],
})
export class GoogleAdsModule {}
