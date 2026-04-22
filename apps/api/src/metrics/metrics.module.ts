import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsIngestionService } from './metrics-ingestion.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  providers: [MetricsService, MetricsIngestionService],
  exports: [MetricsService, MetricsIngestionService],
})
export class MetricsModule {}
