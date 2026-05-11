import { Injectable } from '@nestjs/common';
import { Platform, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSettingsService } from '../admin/admin-settings.service';
import {
  MetricsIngestionAccountFreshnessDto,
  MetricsIngestionObservabilityDto,
  MetricsIngestionRecentRunDto,
} from './dto/ingestion-run.dto';

const RECENT_RUN_CAP = 20;
const FRESHNESS_CAP = 100;

@Injectable()
export class MetricsIngestionObservabilityService {
  constructor(
    private prisma: PrismaService,
    private settings: AdminSettingsService,
  ) {}

  async getObservability(orgId?: string): Promise<MetricsIngestionObservabilityDto> {
    const [enabled, intervalHours, recentRuns, freshness] = await Promise.all([
      this.settings.get<boolean>('metrics.ingestion_enabled'),
      this.settings.get<number>('metrics.ingestion_interval_hours'),
      this.loadRecentRuns(orgId),
      this.loadAccountFreshness(orgId),
    ]);

    return {
      ingestionEnabled: !!enabled,
      intervalHours: intervalHours ?? 6,
      lastRunAt: recentRuns[0]?.startedAt ?? null,
      recentRuns,
      perAccountFreshness: freshness,
      generatedAt: new Date().toISOString(),
    };
  }

  // Pull the most recent metrics.ingest.run audit rows and reshape them.
  private async loadRecentRuns(orgId?: string): Promise<MetricsIngestionRecentRunDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: 'metrics.ingest.run',
        resourceType: 'MetricsIngestion',
        ...(orgId ? { orgId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: RECENT_RUN_CAP,
      select: { afterState: true },
    });

    return rows
      .map((r) => toRecentRun(r.afterState))
      .filter((r): r is MetricsIngestionRecentRunDto => r !== null);
  }

  // For each ad account, find the latest MetricSnapshot.createdAt. We do this with a
  // single grouped query keyed on entityId, then join campaign → ad-account in JS.
  private async loadAccountFreshness(orgId?: string): Promise<MetricsIngestionAccountFreshnessDto[]> {
    const accounts = await this.prisma.adAccount.findMany({
      where: { deletedAt: null, ...(orgId ? { orgId } : {}) },
      select: { id: true, orgId: true, platform: true, name: true },
      take: FRESHNESS_CAP,
      orderBy: { createdAt: 'desc' },
    });
    if (accounts.length === 0) return [];

    const accountIds = accounts.map((a) => a.id);

    const campaigns = await this.prisma.campaign.findMany({
      where: { adAccountId: { in: accountIds }, deletedAt: null },
      select: { id: true, adAccountId: true },
    });

    const campaignIdsByAccount = new Map<string, string[]>();
    for (const c of campaigns) {
      const list = campaignIdsByAccount.get(c.adAccountId) ?? [];
      list.push(c.id);
      campaignIdsByAccount.set(c.adAccountId, list);
    }

    const allCampaignIds = campaigns.map((c) => c.id);
    let latestByCampaign = new Map<string, Date>();
    if (allCampaignIds.length > 0) {
      const rows = await this.prisma.metricSnapshot.groupBy({
        by: ['entityId'],
        where: { entityType: 'CAMPAIGN', entityId: { in: allCampaignIds } },
        _max: { createdAt: true },
      });
      latestByCampaign = new Map(
        rows
          .filter((r) => r._max.createdAt !== null)
          .map((r) => [r.entityId, r._max.createdAt as Date]),
      );
    }

    const now = Date.now();
    return accounts.map((acc) => {
      const ids = campaignIdsByAccount.get(acc.id) ?? [];
      let latest: Date | null = null;
      for (const id of ids) {
        const t = latestByCampaign.get(id);
        if (t && (!latest || t > latest)) latest = t;
      }
      const lastIngestedAt = latest ? latest.toISOString() : null;
      const minutesSinceLastIngestion = latest ? Math.floor((now - latest.getTime()) / 60_000) : null;
      return {
        orgId: acc.orgId,
        adAccountId: acc.id,
        platform: acc.platform as Platform,
        adAccountName: acc.name ?? '',
        campaignCount: ids.length,
        lastIngestedAt,
        minutesSinceLastIngestion,
      };
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// audit_logs.afterState is JSONB — narrow it before exposing to the DTO.
function toRecentRun(state: Prisma.JsonValue | null): MetricsIngestionRecentRunDto | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const s = state as Record<string, unknown>;
  if (typeof s.runId !== 'string' || typeof s.startedAt !== 'string') return null;

  const orgIds = Array.isArray(s.orgIds) ? (s.orgIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];

  return {
    runId: s.runId,
    startedAt: s.startedAt,
    finishedAt: typeof s.finishedAt === 'string' ? s.finishedAt : s.startedAt,
    durationMs: typeof s.durationMs === 'number' ? s.durationMs : 0,
    triggeredBy: s.triggeredBy === 'MANUAL' ? 'MANUAL' : 'SCHEDULER',
    dryRun: !!s.dryRun,
    totalEntities: typeof s.totalEntities === 'number' ? s.totalEntities : 0,
    succeededCount: typeof s.succeededCount === 'number' ? s.succeededCount : 0,
    failedCount: typeof s.failedCount === 'number' ? s.failedCount : 0,
    orgIds,
  };
}
