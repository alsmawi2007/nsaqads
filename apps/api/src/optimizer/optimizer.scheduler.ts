import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TriggeredBy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSettingsService } from '../admin/admin-settings.service';
import { OptimizerService } from './optimizer.service';

@Injectable()
export class OptimizerScheduler implements OnModuleInit {
  private readonly logger = new Logger(OptimizerScheduler.name);

  constructor(
    private prisma: PrismaService,
    private settings: AdminSettingsService,
    private optimizer: OptimizerService,
  ) {}

  onModuleInit() {
    this.logger.log('Optimizer scheduler initialized');
  }

  // Default cron: every hour. The actual interval is also respected via AdminSetting
  // optimizer.cycle_interval_minutes — checked before each cycle run.
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const globalEnabled = await this.settings.get<boolean>('optimizer.enabled');
    if (!globalEnabled) {
      this.logger.log('Optimizer globally disabled — skipping cycle');
      return;
    }

    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    this.logger.log(`Running optimizer cycle for ${orgs.length} organizations`);

    // Run per-org cycles sequentially to avoid DB contention in early versions.
    // Can be made parallel with Promise.allSettled once load is better understood.
    for (const org of orgs) {
      try {
        await this.optimizer.runCycleForOrg(org.id, TriggeredBy.SCHEDULER);
      } catch (err: unknown) {
        this.logger.error(`Optimizer cycle failed for org ${org.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
