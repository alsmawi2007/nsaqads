import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardKPIs {
  totalSpend: number;
  totalConversions: number;
  avgRoas: number;
  avgCpa: number;
  avgCtr: number;
  activeCampaigns: number;
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

    // Run all queries in parallel for minimal latency
    const [snapshots, campaigns, actionsToday, recentActionRows, recentAlerts] = await Promise.all([
      // Latest 24h metric snapshots for all active campaigns
      this.prisma.metricSnapshot.findMany({
        where: {
          orgId,
          entityType: 'CAMPAIGN',
          windowHours: 24,
          snapshotDate: {
            gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
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

    // Build latest-snapshot-per-entity map (most recent first from the sort above)
    const latestByEntity = new Map<string, typeof snapshots[0]>();
    for (const snap of snapshots) {
      if (!latestByEntity.has(snap.entityId)) {
        latestByEntity.set(snap.entityId, snap);
      }
    }

    const allSnaps = [...latestByEntity.values()];

    // Aggregate KPIs from the snapshots
    const totalSpend = allSnaps.reduce((s, x) => s + (x.spend?.toNumber() ?? 0), 0);
    const totalConversions = allSnaps.reduce((s, x) => s + Number(x.conversions ?? 0), 0);
    const roasValues = allSnaps.map((x) => x.roas?.toNumber() ?? 0).filter((v) => v > 0);
    const cpaValues = allSnaps.map((x) => x.cpa?.toNumber() ?? 0).filter((v) => v > 0);
    const ctrValues = allSnaps.map((x) => x.ctr?.toNumber() ?? 0).filter((v) => v > 0);
    const avgRoas = roasValues.length ? roasValues.reduce((a, b) => a + b, 0) / roasValues.length : 0;
    const avgCpa  = cpaValues.length  ? cpaValues.reduce((a, b) => a + b, 0) / cpaValues.length  : 0;
    const avgCtr  = ctrValues.length  ? ctrValues.reduce((a, b) => a + b, 0) / ctrValues.length  : 0;

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
