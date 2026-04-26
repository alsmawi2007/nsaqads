import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FeatureRunTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HllFeatureFlagService } from '../feature-flag.service';
import { FeatureComputeService } from '../features/feature-compute.service';
import { OutcomeService } from '../features/outcome.service';

@Injectable()
export class HistoricalLearningScheduler implements OnModuleInit {
  private readonly logger = new Logger(HistoricalLearningScheduler.name);

  constructor(
    private prisma: PrismaService,
    private flag: HllFeatureFlagService,
    private outcomes: OutcomeService,
    private compute: FeatureComputeService,
  ) {}

  onModuleInit() {
    this.logger.log('HLL scheduler initialized');
  }

  // Daily rollup runs at 02:00 server time. Order is critical:
  // 1. Seal completed campaigns into outcomes
  // 2. Compute global priors (used by org warm-start blending)
  // 3. Compute per-org features
  // 4. Mark stale rows
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCron(): Promise<void> {
    if (!(await this.flag.isGloballyEnabled())) {
      this.logger.log('HLL globally disabled — skipping rollup');
      return;
    }

    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let totalSealed = 0;
    let totalSealSkipped = 0;
    for (const org of orgs) {
      try {
        const result = await this.outcomes.sealCompletedForOrg(org.id);
        totalSealed += result.sealed;
        totalSealSkipped += result.skipped;
      } catch (err: unknown) {
        this.logger.error(
          `Outcome sealing failed for org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(
      `HLL outcomes: sealed=${totalSealed} skipped=${totalSealSkipped} across ${orgs.length} orgs`,
    );

    try {
      await this.compute.runGlobalPriors();
    } catch (err: unknown) {
      this.logger.error(
        `Global priors compute failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let totalWritten = 0;
    let totalSkipped = 0;
    for (const org of orgs) {
      try {
        const run = await this.compute.runForOrg(org.id, FeatureRunTrigger.SCHEDULED);
        totalWritten += run.featuresWritten;
        totalSkipped += run.featuresSkipped;
      } catch (err: unknown) {
        this.logger.error(
          `Feature compute failed for org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const staleMarked = await this.compute.markStale().catch((err: unknown) => {
      this.logger.error(
        `Stale marking failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    });

    this.logger.log(
      `HLL features: written=${totalWritten} skipped=${totalSkipped} stale_marked=${staleMarked}`,
    );
  }
}
