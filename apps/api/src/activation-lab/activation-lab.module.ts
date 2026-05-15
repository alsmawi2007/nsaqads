import { Module } from '@nestjs/common';
import { ActivationLabController } from './activation-lab.controller';
import { ActivationLabService } from './activation-lab.service';

@Module({
  controllers: [ActivationLabController],
  providers:   [ActivationLabService],
})
export class ActivationLabModule {}
