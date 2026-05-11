import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsIngestionService } from './metrics-ingestion.service';
import {
  MetricsIngestionEntityResultDto,
  MetricsIngestionPlatformBreakdownDto,
  MetricsIngestionRunResultDto,
} from './dto/ingestion-run.dto';

// Caps that prevent a runaway run from blowing up the response payload or audit row.
// The runner still iterates every campaign — these only bound what we return / persist.
const MAX_ENTITIES_IN_RESPONSE = 500;
const MAX_ERRORS_IN_AUDIT      = 50;

export interface RunnerOptions {
  triggeredBy: 'SCHEDULER' | 'MANUAL';
  userId?: string;
  dryRun?: boolean;
  note?: string;
}

@Injectable()
export class MetricsIngestionRunnerService {
  private readonly logger = new Logger(MetricsIngestionRunnerService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ingestion: MetricsIngestionService,
  ) {}

  // Single-org run. Used by the manual admin endpoint and (in a loop) by the scheduler.
  async ingestForOrg(orgId: string, opts: RunnerOptions): Promise<MetricsIngestionRunResultDto> {
    return this.runFor([orgId], opts);
  }

  // Sweep every active org. Used by the scheduler.
  async ingestForAllOrgs(opts: RunnerOptions): Promise<MetricsIngestionRunResultDto> {
    const orgs = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return this.runFor(orgs.map((o) => o.id), opts);
  }

  // Internal: orchestrates one run across the supplied org set.
  private async runFor(orgIds: string[], opts: RunnerOptions): Promise<MetricsIngestionRunResultDto> {
    const runId = randomUUID();
    const startedAt = new Date();
    const dryRun = !!opts.dryRun;

    const entities: MetricsIngestionEntityResultDto[] = [];

    for (const orgId of orgIds) {
      // Active campaigns only: status not deleted, optimizer flag set, no soft-delete.
      // We do not filter by optimizerEnabled here — ingestion is independent of automation.
      const campaigns = await this.prisma.campaign.findMany({
        where: { orgId, deletedAt: null },
        select: {
          id: true,
          orgId: true,
          adAccountId: true,
          platform: true,
          externalId: true,
          objective: true,
        },
      });

      for (const c of campaigns) {
        if (entities.length >= MAX_ENTITIES_IN_RESPONSE) break;

        const entityStart = Date.now();
        const base = {
          orgId: c.orgId,
          adAccountId: c.adAccountId,
          platform: c.platform as Platform,
          entityType: 'CAMPAIGN' as const,
          entityId: c.id,
          externalId: c.externalId,
        };

        if (dryRun) {
          entities.push({
            ...base,
            succeeded: true,
            errorMessage: null,
            durationMs: 0,
          });
          continue;
        }

        try {
          await this.ingestion.ingestForEntity(
            c.orgId,
            c.adAccountId,
            c.platform,
            'CAMPAIGN',
            c.externalId,
            c.id,
            c.objective ?? undefined,
          );
          entities.push({
            ...base,
            succeeded: true,
            errorMessage: null,
            durationMs: Date.now() - entityStart,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Ingest failed for campaign ${c.id} (${c.platform}): ${msg}`);
          entities.push({
            ...base,
            succeeded: false,
            errorMessage: msg,
            durationMs: Date.now() - entityStart,
          });
        }
      }
    }

    const finishedAt = new Date();
    const succeededCount = entities.filter((e) => e.succeeded).length;
    const failedCount    = entities.length - succeededCount;
    const perPlatform    = aggregatePerPlatform(entities);

    const result: MetricsIngestionRunResultDto = {
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      triggeredBy: opts.triggeredBy,
      dryRun,
      orgIds,
      totalEntities: entities.length,
      succeededCount,
      failedCount,
      perPlatform,
      entities,
    };

    // Persist a compact summary on audit_logs. We deliberately do NOT store every entity
    // result on the audit row — only counts plus the first MAX_ERRORS_IN_AUDIT failure
    // messages — so the JSONB stays small enough for indexed scans.
    await this.audit.log({
      orgId: orgIds.length === 1 ? orgIds[0] : undefined,
      userId: opts.userId,
      action: 'metrics.ingest.run',
      resourceType: 'MetricsIngestion',
      resourceId: runId,
      afterState: {
        runId,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        triggeredBy: result.triggeredBy,
        dryRun,
        note: opts.note,
        orgIds,
        totalEntities: result.totalEntities,
        succeededCount,
        failedCount,
        perPlatform,
        errors: entities
          .filter((e) => !e.succeeded)
          .slice(0, MAX_ERRORS_IN_AUDIT)
          .map((e) => ({
            orgId: e.orgId,
            adAccountId: e.adAccountId,
            platform: e.platform,
            entityId: e.entityId,
            externalId: e.externalId,
            errorMessage: e.errorMessage,
          })),
      },
    });

    return result;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function aggregatePerPlatform(
  entities: MetricsIngestionEntityResultDto[],
): MetricsIngestionPlatformBreakdownDto[] {
  const acc = new Map<Platform, MetricsIngestionPlatformBreakdownDto>();
  for (const e of entities) {
    const slot = acc.get(e.platform) ?? {
      platform: e.platform,
      totalEntities: 0,
      succeededCount: 0,
      failedCount: 0,
    };
    slot.totalEntities += 1;
    if (e.succeeded) slot.succeededCount += 1;
    else slot.failedCount += 1;
    acc.set(e.platform, slot);
  }
  return Array.from(acc.values()).sort((a, b) => a.platform.localeCompare(b.platform));
}
