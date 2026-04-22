import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { MetricsModule } from '../metrics/metrics.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [MetricsModule, ProvidersModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
