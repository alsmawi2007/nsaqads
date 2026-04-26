import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { CampaignArchitectController } from './campaign-architect.controller';
import { DecisionEngineService } from './decision/decision-engine.service';
import { RiskCheckService } from './risk/risk-check.service';
import { StrategicSummaryService } from './summary/strategic-summary.service';
import { PlanService } from './plan/plan.service';
import { LauncherService } from './launcher/launcher.service';

@Module({
  imports: [ProvidersModule],
  controllers: [CampaignArchitectController],
  providers: [
    DecisionEngineService,
    RiskCheckService,
    StrategicSummaryService,
    PlanService,
    LauncherService,
  ],
  exports: [
    DecisionEngineService,
    RiskCheckService,
    StrategicSummaryService,
    PlanService,
    LauncherService,
  ],
})
export class CampaignArchitectModule {}
