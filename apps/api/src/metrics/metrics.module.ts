import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MetricsService } from './metrics.service';
import { MetricsIngestionService } from './metrics-ingestion.service';
import { MetricsIngestionRunnerService } from './metrics-ingestion-runner.service';
import { MetricsIngestionScheduler } from './metrics-ingestion.scheduler';
import { MetricsIngestionObservabilityService } from './metrics-ingestion-observability.service';
import { MetricsAdminController } from './admin/metrics-admin.controller';
import { MetricsOrgController } from './metrics-org.controller';
import { ProvidersModule } from '../providers/providers.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [ScheduleModule.forRoot(), ProvidersModule, AdminModule],
  controllers: [MetricsAdminController, MetricsOrgController],
  providers: [
    MetricsService,
    MetricsIngestionService,
    MetricsIngestionRunnerService,
    MetricsIngestionScheduler,
    MetricsIngestionObservabilityService,
  ],
  exports: [
    MetricsService,
    MetricsIngestionService,
    MetricsIngestionRunnerService,
  ],
})
export class MetricsModule {}
