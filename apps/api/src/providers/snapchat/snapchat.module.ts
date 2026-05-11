import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';
import { MockProvider } from '../mock/mock.provider';
import { AdAccountLoader } from '../shared/ad-account.loader';
import { NoopRateLimiter, RATE_LIMITER } from '../shared/rate-limiter';
import { SnapchatApiClient } from './snapchat-api.client';
import { SnapchatMapperService } from './snapchat-mapper.service';
import { SnapchatProvider } from './snapchat.provider';
import { SnapchatOAuthService } from './snapchat-oauth.service';
import { SnapchatOAuthController } from './snapchat-oauth.controller';
import { SnapchatTokenService } from './snapchat-token.service';
import { SnapchatTokenScheduler } from './snapchat-token.scheduler';
import {
  DEFAULT_SNAP_CONVERSION_MAP,
  SNAP_CONVERSION_MAP,
} from './snapchat-conversion-config';

// All Snapchat-specific wiring lives here. The outer ProvidersModule imports
// this module and consumes only SnapchatProvider + MockProvider + ProviderFactory.
@Module({
  imports: [PrismaModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [SnapchatOAuthController],
  providers: [
    MockProvider,
    AdAccountLoader,
    { provide: RATE_LIMITER,         useClass: NoopRateLimiter },
    { provide: SNAP_CONVERSION_MAP,  useValue: DEFAULT_SNAP_CONVERSION_MAP },
    SnapchatApiClient,
    SnapchatMapperService,
    SnapchatTokenService,
    SnapchatTokenScheduler,
    SnapchatOAuthService,
    SnapchatProvider,
  ],
  exports: [SnapchatProvider, MockProvider, AdAccountLoader, SnapchatTokenService],
})
export class SnapchatModule {}
