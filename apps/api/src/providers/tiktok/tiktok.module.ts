import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';
import { MockProvider } from '../mock/mock.provider';
import { AdAccountLoader } from '../shared/ad-account.loader';
import { NoopRateLimiter, RATE_LIMITER } from '../shared/rate-limiter';
import { TikTokApiClient } from './tiktok-api.client';
import { TikTokMapperService } from './tiktok-mapper.service';
import { TikTokProvider } from './tiktok.provider';
import { TikTokOAuthService } from './tiktok-oauth.service';
import { TikTokOAuthController } from './tiktok-oauth.controller';
import { TikTokTokenService } from './tiktok-token.service';
import { TikTokTokenScheduler } from './tiktok-token.scheduler';
import {
  DEFAULT_TIKTOK_CONVERSION_MAP,
  TIKTOK_CONVERSION_MAP,
} from './tiktok-conversion-config';

// All TikTok-specific wiring lives here. The outer ProvidersModule imports
// this module and consumes only TikTokProvider + MockProvider + ProviderFactory.
@Module({
  imports: [PrismaModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [TikTokOAuthController],
  providers: [
    MockProvider,
    AdAccountLoader,
    { provide: RATE_LIMITER,           useClass: NoopRateLimiter },
    { provide: TIKTOK_CONVERSION_MAP,  useValue: DEFAULT_TIKTOK_CONVERSION_MAP },
    TikTokApiClient,
    TikTokMapperService,
    TikTokTokenService,
    TikTokTokenScheduler,
    TikTokOAuthService,
    TikTokProvider,
  ],
  exports: [TikTokProvider, MockProvider, AdAccountLoader, TikTokTokenService],
})
export class TikTokModule {}
