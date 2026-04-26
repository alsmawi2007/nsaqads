import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { HistoricalLearningAdminController } from './admin/historical-learning-admin.controller';
import { HllFeatureFlagService } from './feature-flag.service';
import { FeatureComputeService } from './features/feature-compute.service';
import { OutcomeService } from './features/outcome.service';
import { HistoricalLearningScheduler } from './scheduler/historical-learning.scheduler';
import { MultiplierService } from './scoring/multiplier.service';
import { HllPlanAdjusterService } from './scoring/plan-adjuster.service';
import { HllScoringService } from './scoring/scoring.service';

@Module({
  imports: [AdminModule],
  controllers: [HistoricalLearningAdminController],
  providers: [
    HllFeatureFlagService,
    OutcomeService,
    FeatureComputeService,
    HistoricalLearningScheduler,
    MultiplierService,
    HllScoringService,
    HllPlanAdjusterService,
  ],
  exports: [HllScoringService, HllFeatureFlagService, HllPlanAdjusterService],
})
export class HistoricalLearningModule {}
