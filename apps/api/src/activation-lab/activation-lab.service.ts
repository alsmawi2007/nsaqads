import { Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Shape returned by GET /orgs/:orgId/activation-lab. The web "Provider
// Activation Lab" panel renders this directly into status cards and a
// ready-checklist — every field here drives one row of UI.
export interface ActivationLabStatus {
  orgId: string;
  generatedAt: string;
  providers: ProviderRow[];
  adAccounts: {
    total: number;
    tracked: number;
    available: number;
    perPlatform: Array<{ platform: Platform; tracked: number; available: number }>;
  };
  campaigns: {
    total: number;
    byStatus: Record<string, number>;
    byPhase: Record<string, number>;
    eligibleForOptimizer: number;       // count(NOT LEARNING)
    activeAndEligible: number;          // ACTIVE + NOT LEARNING
  };
  adSets: { total: number };
  ingestion: {
    snapshotsLast24h: number;
    lastRunAt: string | null;
    lastRunSummary: string | null;
  };
  optimizer: {
    ruleCount: number;                  // applicable rules (org + global)
    autoApplyEnabled: boolean;          // true if any campaign is on AUTO_APPLY
    cooldownActive: number;             // entities currently inside cooldown
  };
  ready: ReadyChecklist;
}

export interface ProviderRow {
  platform: Platform;
  isConfigured: boolean;
  isEnabled: boolean;
}

export interface ReadyChecklist {
  providerConnected:        ChecklistItem;
  adAccountTracked:         ChecklistItem;
  campaignsSynced:          ChecklistItem;
  activeCampaigns:          ChecklistItem;
  campaignPhaseEligible:    ChecklistItem;
  metricSnapshotsAvailable: ChecklistItem;
  optimizerRulesAvailable:  ChecklistItem;
  autoApplyDisabled:        ChecklistItem;
}

export interface ChecklistItem {
  status: 'ok' | 'warn' | 'missing';
  detail: string;
}

@Injectable()
export class ActivationLabService {
  constructor(private prisma: PrismaService) {}

  async getStatus(orgId: string): Promise<ActivationLabStatus> {
    const [
      providers,
      adAccounts,
      campaigns,
      adSetCount,
      ingestionSummary,
      ruleCount,
      autoApplyCount,
      cooldownCount,
    ] = await Promise.all([
      this.providersStatus(),
      this.adAccountsStatus(orgId),
      this.campaignsStatus(orgId),
      this.prisma.adSet.count({ where: { orgId, deletedAt: null } }),
      this.ingestionStatus(orgId),
      this.prisma.optimizerRule.count({ where: { OR: [{ orgId }, { orgId: null }] } }),
      this.prisma.campaign.count({ where: { orgId, optimizerMode: 'AUTO_APPLY' } }),
      this.prisma.cooldownTracker.count({
        where: { orgId, expiresAt: { gt: new Date() } },
      }),
    ]);

    const ready = this.buildChecklist({
      providers,
      tracked: adAccounts.tracked,
      campaignsTotal: campaigns.total,
      activeAndEligible: campaigns.activeAndEligible,
      activeCount: campaigns.byStatus.ACTIVE ?? 0,
      eligibleCount: campaigns.eligibleForOptimizer,
      snapshotsLast24h: ingestionSummary.snapshotsLast24h,
      ruleCount,
      autoApplyCount,
    });

    return {
      orgId,
      generatedAt: new Date().toISOString(),
      providers,
      adAccounts,
      campaigns,
      adSets: { total: adSetCount },
      ingestion: ingestionSummary,
      optimizer: {
        ruleCount,
        autoApplyEnabled: autoApplyCount > 0,
        cooldownActive: cooldownCount,
      },
      ready,
    };
  }

  private async providersStatus(): Promise<ProviderRow[]> {
    const rows = await this.prisma.providerConfig.findMany({
      select: { platform: true, isEnabled: true, appSecretCipher: true },
    });
    const byPlatform = new Map<Platform, ProviderRow>();
    for (const r of rows) {
      byPlatform.set(r.platform, {
        platform:     r.platform,
        isConfigured: !!r.appSecretCipher,
        isEnabled:    r.isEnabled,
      });
    }
    // Always return a row per known platform so the UI can render disabled
    // cards for platforms not yet configured.
    return (Object.values(Platform) as Platform[]).map(
      (p) => byPlatform.get(p) ?? { platform: p, isConfigured: false, isEnabled: false },
    );
  }

  private async adAccountsStatus(orgId: string) {
    const rows = await this.prisma.adAccount.findMany({
      where: { orgId, deletedAt: null },
      select: { platform: true, isTracked: true },
    });
    const perPlatform = new Map<Platform, { tracked: number; available: number }>();
    let tracked = 0;
    for (const r of rows) {
      if (r.isTracked) tracked += 1;
      const slot = perPlatform.get(r.platform) ?? { tracked: 0, available: 0 };
      if (r.isTracked) slot.tracked += 1; else slot.available += 1;
      perPlatform.set(r.platform, slot);
    }
    return {
      total:     rows.length,
      tracked,
      available: rows.length - tracked,
      perPlatform: Array.from(perPlatform.entries()).map(([platform, counts]) => ({ platform, ...counts })),
    };
  }

  private async campaignsStatus(orgId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { orgId, deletedAt: null },
      select: { status: true, campaignPhase: true },
    });
    const byStatus: Record<string, number> = {};
    const byPhase: Record<string, number> = {};
    let activeAndEligible = 0;
    for (const c of campaigns) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      byPhase[c.campaignPhase] = (byPhase[c.campaignPhase] ?? 0) + 1;
      if (c.status === 'ACTIVE' && c.campaignPhase !== 'LEARNING') activeAndEligible += 1;
    }
    return {
      total: campaigns.length,
      byStatus,
      byPhase,
      eligibleForOptimizer: campaigns.filter((c) => c.campaignPhase !== 'LEARNING').length,
      activeAndEligible,
    };
  }

  private async ingestionStatus(orgId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [snapshotsLast24h, lastRunAudit] = await Promise.all([
      this.prisma.metricSnapshot.count({ where: { orgId, createdAt: { gte: since } } }),
      this.prisma.auditLog.findFirst({
        where: { orgId, action: 'metrics.ingest.run' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, afterState: true },
      }),
    ]);

    let lastRunSummary: string | null = null;
    if (lastRunAudit) {
      const a = lastRunAudit.afterState as Record<string, unknown> | null;
      const ok     = (a?.['successCount'] as number | undefined) ?? 0;
      const failed = (a?.['failedCount']  as number | undefined) ?? 0;
      lastRunSummary = `${ok} ok · ${failed} failed`;
    }
    return {
      snapshotsLast24h,
      lastRunAt:      lastRunAudit?.createdAt.toISOString() ?? null,
      lastRunSummary,
    };
  }

  private buildChecklist(d: {
    providers: ProviderRow[];
    tracked: number;
    campaignsTotal: number;
    activeAndEligible: number;
    activeCount: number;
    eligibleCount: number;
    snapshotsLast24h: number;
    ruleCount: number;
    autoApplyCount: number;
  }): ReadyChecklist {
    const enabledProviders = d.providers.filter((p) => p.isConfigured && p.isEnabled);
    return {
      providerConnected: enabledProviders.length > 0
        ? { status: 'ok', detail: `${enabledProviders.length} provider(s) enabled` }
        : { status: 'missing', detail: 'No provider is configured + enabled' },

      adAccountTracked: d.tracked > 0
        ? { status: 'ok', detail: `${d.tracked} ad account(s) being tracked` }
        : { status: 'missing', detail: 'No ad accounts opted in — open /ad-accounts → Available → Track' },

      campaignsSynced: d.campaignsTotal > 0
        ? { status: 'ok', detail: `${d.campaignsTotal} campaign(s) synced` }
        : { status: 'missing', detail: 'No campaigns yet — click Sync on a tracked account' },

      activeCampaigns: d.activeCount > 0
        ? { status: 'ok', detail: `${d.activeCount} active campaign(s)` }
        : { status: 'warn', detail: 'No active campaigns — paused campaigns receive zero metrics' },

      campaignPhaseEligible: d.eligibleCount > 0
        ? { status: 'ok', detail: `${d.eligibleCount} campaign(s) past LEARNING` }
        : { status: 'warn', detail: 'All campaigns are still in LEARNING — optimizer holds back by design. Use the Phase Override on the campaign detail page for activation testing.' },

      metricSnapshotsAvailable: d.snapshotsLast24h > 0
        ? { status: 'ok', detail: `${d.snapshotsLast24h} snapshots in the last 24h` }
        : { status: 'missing', detail: 'No metric snapshots in 24h — run ingestion' },

      optimizerRulesAvailable: d.ruleCount > 0
        ? { status: 'ok', detail: `${d.ruleCount} rule(s) loaded` }
        : { status: 'missing', detail: 'No rules — seed defaults or define org-level rules' },

      autoApplyDisabled: d.autoApplyCount === 0
        ? { status: 'ok', detail: 'No campaign is on AUTO_APPLY — safe' }
        : { status: 'warn', detail: `${d.autoApplyCount} campaign(s) on AUTO_APPLY — the optimizer will mutate the platform without approval` },
    };
  }
}
