import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';
import { MockProvider } from '../mock/mock.provider';
import { AdAccountLoader } from '../shared/ad-account.loader';
import { NoopRateLimiter, RATE_LIMITER } from '../shared/rate-limiter';
import { MetaApiClient } from './meta-api.client';
import { MetaMapperService } from './meta-mapper.service';
import { MetaProvider } from './meta.provider';
import { MetaOAuthService } from './meta-oauth.service';
import { MetaOAuthController } from './meta-oauth.controller';
import { MetaTokenService } from './meta-token.service';
import { MetaTokenScheduler } from './meta-token.scheduler';
import {
  DEFAULT_META_CONVERSION_MAP,
  META_CONVERSION_MAP,
} from './meta-conversion-config';

// All Meta-specific wiring lives here. The outer ProvidersModule imports this
// module and consumes only MetaProvider + MockProvider + ProviderFactory.
@Module({
  imports: [PrismaModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [MetaOAuthController],
  providers: [
    MockProvider,           // re-provided so MetaProvider can compose it
    AdAccountLoader,
    { provide: RATE_LIMITER,         useClass: NoopRateLimiter },
    { provide: META_CONVERSION_MAP,  useValue: DEFAULT_META_CONVERSION_MAP },
    MetaApiClient,
    MetaMapperService,
    MetaTokenService,
    MetaTokenScheduler,
    MetaOAuthService,
    MetaProvider,
  ],
  exports: [MetaProvider, MockProvider, AdAccountLoader, MetaTokenService],
})
export class MetaModule {}
