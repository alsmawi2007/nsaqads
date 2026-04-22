import { Module } from '@nestjs/common';
import { MockProvider } from './mock/mock.provider';
import { ProviderFactory } from './factory/provider.factory';

@Module({
  providers: [MockProvider, ProviderFactory],
  exports: [ProviderFactory],
})
export class ProvidersModule {}
