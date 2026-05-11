import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class HealthModule {}
