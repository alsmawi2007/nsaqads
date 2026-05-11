import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSettingsService } from '../admin/admin-settings.service';
import { MetricsIngestionRunnerService } from './metrics-ingestion-runner.service';

// Default ingestion cadence — overridden by AdminSetting metrics.ingestion_interval_hours.
const DEFAULT_INTERVAL_HOURS = 6;

@Injectable()
export class MetricsIngestionScheduler implements OnModuleInit {
  private readonly logger = new Logger(MetricsIngestionScheduler.name);

  constructor(
    private prisma: PrismaService,
    private settings: AdminSettingsService,
    private runner: MetricsIngestionRunnerService,
  ) {}

  onModuleInit() {
    this.logger.log('Metrics ingestion scheduler initialized');
  }

  // We tick every hour and decide whether to actually ingest by inspecting the most
  // recent successful run from audit_logs. This keeps the cadence configurable at
  // runtime via AdminSetting rather than baked into the cron expression.
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const enabled = await this.settings.get<boolean>('metrics.ingestion_enabled');
    if (!enabled) {
      this.logger.log('Metrics ingestion globally disabled — skipping cycle');
      return;
    }

    const intervalHours = await this.settings.get<number>('metrics.ingestion_interval_hours');
    const dueAt = await this.computeNextDueAt(intervalHours ?? DEFAULT_INTERVAL_HOURS);
    if (dueAt > new Date()) {
      this.logger.log(`Last ingestion is recent — next due at ${dueAt.toISOString()}`);
      return;
    }

    this.logger.log('Starting scheduled metrics ingestion run');
    try {
      const result = await this.runner.ingestForAllOrgs({ triggeredBy: 'SCHEDULER' });
      this.logger.log(
        `Scheduled run ${result.runId} done: orgs=${result.orgIds.length} ` +
        `entities=${result.totalEntities} ok=${result.succeededCount} failed=${result.failedCount} ` +
        `durationMs=${result.durationMs}`,
      );
    } catch (err: unknown) {
      this.logger.error(`Scheduled metrics ingestion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Looks up the most recent metrics.ingest.run audit row and returns when the next
  // run is due. Returns "epoch" when no prior run exists so the first tick fires.
  private async computeNextDueAt(intervalHours: number): Promise<Date> {
    const last = await this.prisma.auditLog.findFirst({
      where: { action: 'metrics.ingest.run', resourceType: 'MetricsIngestion' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!last) return new Date(0);
    return new Date(last.createdAt.getTime() + intervalHours * 60 * 60 * 1000);
  }
}
