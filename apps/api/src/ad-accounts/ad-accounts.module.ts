import { Module } from '@nestjs/common';
import { AdAccountsController } from './ad-accounts.controller';
import { AdAccountsService } from './ad-accounts.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [AdAccountsController],
  providers: [AdAccountsService],
  exports: [AdAccountsService],
})
export class AdAccountsModule {}
