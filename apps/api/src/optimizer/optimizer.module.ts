import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OptimizerController } from './optimizer.controller';
import { OptimizerService } from './optimizer.service';
import { OptimizerScheduler } from './optimizer.scheduler';
import { EvaluatorService } from './evaluator.service';
import { GuardrailService } from './guardrail.service';
import { ExecutorService } from './executor.service';
import { CooldownService } from './cooldown.service';
import { ProvidersModule } from '../providers/providers.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [ScheduleModule.forRoot(), ProvidersModule, AdminModule],
  controllers: [OptimizerController],
  providers: [
    OptimizerService,
    OptimizerScheduler,
    EvaluatorService,
    GuardrailService,
    ExecutorService,
    CooldownService,
  ],
  exports: [OptimizerService, CooldownService],
})
export class OptimizerModule {}
