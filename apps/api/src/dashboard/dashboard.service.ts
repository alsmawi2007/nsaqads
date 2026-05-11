import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardKPITrends {
  spend: number;          // % change vs yesterday (positive = up)
  conversions: number;
  roas: number;
  cpa: number;            // for CPA, negative = good (lower cost)
  ctr: number;
}

export interface DashboardKPIs {
  totalSpend: number;
  totalConversions: number;
  avgRoas: number;
  avgCpa: number;
  avgCtr: number;
  activeCampaigns: number;
  trends: DashboardKPITrends;
}

export interface DashboardCampaignMetrics {
  spend: number;
  roas: number;
  cpa: number;
  ctr: number;
  conversions: number;
  spendPacing: number;
}

export interface DashboardCampaign {
  id: string;
  name: string;
  platform: string;
  status: string;
  campaignPhase: string;
  optimizerMode: string;
  dailyBudget: number | null;
  metrics: DashboardCampaignMetrics;
}

export interface DashboardOptimizerToday {
  applied: number;
  pending: number;
  failed: number;
  skipped: number;
}

export interface DashboardAlert {
  id: string;
  alertType: string;
  severity: string;
  message: string;
  entityType: string;
  isRead: boolean;
  campaignName: string | null;
  createdAt: string;
}

export interface DashboardAction {
  id: string;
  actionType: string;
  status: string;
  triggeredBy: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  explanation: { en: string; ar: string | null };
  campaignName: string;
  createdAt: string;
}

export interface DashboardSummary {
  kpis: DashboardKPIs;
  campaigns: DashboardCampaign[];
  optimizerToday: DashboardOptimizerToday;
  recentActions: DashboardAction[];
  recentAlerts: DashboardAlert[];
  generatedAt: string;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary(orgId: string): Promise<DashboardSummary> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Run all queries in parallel for minimal latency.
    // Snapshot window: 72h so we can split into "today" (most recent per campaign)
    // vs "yesterday" (next-most-recent ≥ 24h older) for trend comparison.
    const [snapshots, campaigns, actionsToday, recentActionRows, recentAlerts] = await Promise.all([
      this.prisma.metricSnapshot.findMany({
        where: {
          orgId,
          entityType: 'CAMPAIGN',
          windowHours: 24,
          snapshotDate: {
            gte: new Date(Date.now() - 72 * 60 * 60 * 1000),
          },
        },
        orderBy: { snapshotDate: 'desc' },
      }),

      // Active campaigns with phase and mode
      this.prisma.campaign.findMany({
        where: { orgId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          platform: true,
          status: true,
          campaignPhase: true,
          optimizerMode: true,
          dailyBudget: true,
        },
      }),

      // Optimizer actions triggered today
      this.prisma.optimizerAction.groupBy({
        by: ['status'],
        where: {
          orgId,
          createdAt: { gte: todayStart },
        },
        _count: { status: true },
      }),

      // Recent optimizer actions (today + yesterday)
      this.prisma.optimizerAction.findMany({
        where: {
          orgId,
          createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),

      // Alerts (unread first, then recent), most recent 5
      this.prisma.alert.findMany({
        where: { orgId, resolvedAt: null },
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          alertType: true,
          severity: true,
          message: true,
          entityType: true,
          entityId: true,
          isRead: true,
          createdAt: true,
        },
      }),
    ]);

    // Build today/yesterday snapshot maps. Snapshots are sorted desc above,
    // so the first hit per entity is "today" and the next one ≥ 18h older is "yesterday".
    const latestByEntity      = new Map<string, typeof snapshots[0]>();
    const yesterdayByEntity   = new Map<string, typeof snapshots[0]>();
    const YESTERDAY_GAP_HOURS = 18; // tolerance: snapshots taken anywhere from ~18–30h before today's
    for (const snap of snapshots) {
      const today = latestByEntity.get(snap.entityId);
      if (!today) {
        latestByEntity.set(snap.entityId, snap);
        continue;
      }
      if (yesterdayByEntity.has(snap.entityId)) continue;
      const gapHours = (today.snapshotDate.getTime() - snap.snapshotDate.getTime()) / 3_600_000;
      if (gapHours >= YESTERDAY_GAP_HOURS) {
        yesterdayByEntity.set(snap.entityId, snap);
      }
    }

    const todaySnaps     = [...latestByEntity.values()];
    const yesterdaySnaps = [...yesterdayByEntity.values()];

    // Aggregate KPIs from today's snapshots
    const aggregate = (snaps: typeof snapshots) => {
      const spend       = snaps.reduce((s, x) => s + (x.spend?.toNumber() ?? 0), 0);
      const conversions = snaps.reduce((s, x) => s + Number(x.conversions ?? 0), 0);
      const roasValues  = snaps.map((x) => x.roas?.toNumber() ?? 0).filter((v) => v > 0);
      const cpaValues   = snaps.map((x) => x.cpa?.toNumber()  ?? 0).filter((v) => v > 0);
      const ctrValues   = snaps.map((x) => x.ctr?.toNumber()  ?? 0).filter((v) => v > 0);
      const avg = (vs: number[]) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0);
      return {
        spend, conversions,
        roas: avg(roasValues), cpa: avg(cpaValues), ctr: avg(ctrValues),
      };
    };

    const today     = aggregate(todaySnaps);
    const yesterday = aggregate(yesterdaySnaps);

    // Percent change vs yesterday — 0 when yesterday is 0 or absent (avoids divide-by-zero).
    const pctChange = (now: number, prev: number) => (prev > 0 ? ((now - prev) / prev) * 100 : 0);

    const trends: DashboardKPITrends = {
      spend:       pctChange(today.spend,       yesterday.spend),
      conversions: pctChange(today.conversions, yesterday.conversions),
      roas:        pctChange(today.roas,        yesterday.roas),
      cpa:         pctChange(today.cpa,         yesterday.cpa),
      ctr:         pctChange(today.ctr,         yesterday.ctr),
    };

    const totalSpend       = today.spend;
    const totalConversions = today.conversions;
    const avgRoas          = today.roas;
    const avgCpa           = today.cpa;
    const avgCtr           = today.ctr;

    // Enrich campaigns with their latest snapshot metrics
    const enrichedCampaigns: DashboardCampaign[] = campaigns.map((c) => {
      const snap = latestByEntity.get(c.id);
      return {
        id: c.id,
        name: c.name,
        platform: c.platform,
        status: c.status,
        campaignPhase: c.campaignPhase,
        optimizerMode: c.optimizerMode,
        dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null,
        metrics: {
          spend:        snap?.spend?.toNumber()       ?? 0,
          roas:         snap?.roas?.toNumber()        ?? 0,
          cpa:          snap?.cpa?.toNumber()         ?? 0,
          ctr:          snap?.ctr?.toNumber()         ?? 0,
          conversions:  Number(snap?.conversions      ?? 0),
          spendPacing:  snap?.spendPacing?.toNumber() ?? 0,
        },
      };
    });

    // Campaign name lookup for enriching actions and alerts
    const campaignNameMap = new Map(campaigns.map((c) => [c.id, c.name]));

    // If actions reference campaigns not in the active list, fetch their names
    const missingCampaignIds = [
      ...new Set(
        recentActionRows
          .filter((a) => a.entityType === 'CAMPAIGN' && !campaignNameMap.has(a.entityId))
          .map((a) => a.entityId),
      ),
    ];
    if (missingCampaignIds.length > 0) {
      const extra = await this.prisma.campaign.findMany({
        where: { id: { in: missingCampaignIds } },
        select: { id: true, name: true },
      });
      for (const c of extra) campaignNameMap.set(c.id, c.name);
    }

    // Normalize optimizer today counts
    const countByStatus: Record<string, number> = {};
    for (const row of actionsToday) {
      countByStatus[row.status] = row._count.status;
    }

    return {
      kpis: {
        totalSpend,
        totalConversions: Number(totalConversions),
        avgRoas,
        avgCpa,
        avgCtr,
        activeCampaigns: campaigns.length,
        trends,
      },
      campaigns: enrichedCampaigns,
      optimizerToday: {
        applied: countByStatus['APPLIED'] ?? 0,
        pending: countByStatus['PENDING'] ?? 0,
        failed:  countByStatus['FAILED']  ?? 0,
        skipped: countByStatus['SKIPPED'] ?? 0,
      },
      recentActions: recentActionRows.map((a) => ({
        id: a.id,
        actionType: a.actionType,
        status: a.status,
        triggeredBy: a.triggeredBy,
        before: a.beforeValue as Record<string, unknown>,
        after: a.afterValue as Record<string, unknown>,
        explanation: a.explanation as { en: string; ar: string | null },
        campaignName: campaignNameMap.get(a.entityId) ?? '—',
        createdAt: a.createdAt.toISOString(),
      })),
      recentAlerts: recentAlerts.map((a) => ({
        id: a.id,
        alertType: a.alertType,
        severity: a.severity,
        message: a.message,
        entityType: a.entityType,
        isRead: a.isRead,
        campaignName: a.entityType === 'CAMPAIGN' ? (campaignNameMap.get(a.entityId) ?? null) : null,
        createdAt: a.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
