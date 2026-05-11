import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardIntelligenceService } from './dashboard-intelligence.service';
import { InsightsModule } from '../insights/insights.module';

@Module({
  imports: [InsightsModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardIntelligenceService],
})
export class DashboardModule {}
