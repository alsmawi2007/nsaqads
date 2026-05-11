import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';
import { InsightsAdminController } from './admin/insights-admin.controller';
import { TrendAnalyzerService } from './trends/trend-analyzer.service';
import { InsightScorerService } from './scoring/insight-scorer.service';
import { InsightInteractionsService } from './interactions/insight-interactions.service';
import { InsightAnalyticsService } from './analytics/insight-analytics.service';
import { RulePerformanceService } from './learning/rule-performance.service';
import { RuleTunerSimulationService } from './learning/rule-tuner-simulation.service';
import { RuleTunerService } from './learning/rule-tuner.service';
import { OptimizerModule } from '../optimizer/optimizer.module';

// Read-only insights surface. Insights themselves are computed on-demand and
// never persisted; only per-user lifecycle/feedback (insight_interactions) is
// stored. No executor, no provider calls, no writes to ad platforms.
@Module({
  imports: [OptimizerModule],
  controllers: [InsightsController, InsightsAdminController],
  providers: [
    InsightsService,
    TrendAnalyzerService,
    InsightScorerService,
    InsightInteractionsService,
    InsightAnalyticsService,
    RulePerformanceService,
    RuleTunerSimulationService,
    RuleTunerService,
  ],
  exports: [
    InsightsService,
    TrendAnalyzerService,
    InsightScorerService,
    InsightInteractionsService,
    InsightAnalyticsService,
    RulePerformanceService,
    RuleTunerSimulationService,
    RuleTunerService,
  ],
})
export class InsightsModule {}
