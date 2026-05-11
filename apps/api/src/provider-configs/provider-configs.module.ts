import { Global, Module } from '@nestjs/common';
import { ProviderConfigsService } from './provider-configs.service';
import { ProviderConfigsController } from './provider-configs.controller';

// Global so any provider module (Meta, TikTok, ...) can inject
// ProviderConfigsService without explicit imports.
@Global()
@Module({
  controllers: [ProviderConfigsController],
  providers: [ProviderConfigsService],
  exports: [ProviderConfigsService],
})
export class ProviderConfigsModule {}
