import { Injectable } from '@nestjs/common';
import { OptimizerMode, Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSettingsService } from '../admin/admin-settings.service';
import {
  ReadinessAdAccountsDto,
  ReadinessGuardrailsDto,
  ReadinessIngestionDto,
  ReadinessIntelligenceDto,
  ReadinessProviderConfigsDto,
  ReadinessResponseDto,
} from './readiness.dto';

// Compose a single read-only readiness picture used during production rollout.
// Every pillar is independent — Promise.all is safe.
@Injectable()
export class ReadinessService {
  constructor(
    private prisma: PrismaService,
    private settings: AdminSettingsService,
  ) {}

  async getReadiness(): Promise<ReadinessResponseDto> {
    const [providerConfigs, adAccounts, ingestion, intelligence, guardrails] = await Promise.all([
      this.providerConfigsPillar(),
      this.adAccountsPillar(),
      this.ingestionPillar(),
      this.intelligencePillar(),
      this.guardrailsPillar(),
    ]);

    const blockers: string[] = [];

    // Unsafe = guardrails violated. Do NOT roll out under this state.
    if (!guardrails.rolloutSafetyOk) {
      if (guardrails.autoTuneEnabled) {
        blockers.push('UNSAFE: learning.auto_tune_enabled is true — set it to false before initial rollout.');
      }
      if (guardrails.autoApplyCampaignCount > 0) {
        blockers.push(
          `UNSAFE: ${guardrails.autoApplyCampaignCount} campaign(s) on AUTO_APPLY — switch to SUGGEST_ONLY before initial rollout.`,
        );
      }
    }

    // Degraded = pipeline is incomplete but not dangerous.
    if (providerConfigs.enabled === 0) blockers.push('No provider config is enabled — Meta must be enabled before OAuth.');
    if (adAccounts.active === 0) blockers.push('No active AdAccount — complete Meta OAuth + connect at least one account.');
    if (ingestion.lastIngestionAt === null) blockers.push('No metrics ingested yet — run POST /admin/metrics/ingest/run.');
    if (!ingestion.enabled) blockers.push('metrics.ingestion_enabled is false — scheduled ingestion will not run.');

    let status: 'ready' | 'degraded' | 'unsafe' = 'ready';
    if (!guardrails.rolloutSafetyOk) status = 'unsafe';
    else if (blockers.length > 0) status = 'degraded';

    return {
      status,
      blockers,
      providerConfigs,
      adAccounts,
      ingestion,
      intelligence,
      guardrails,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Pillars ────────────────────────────────────────────────────────────────

  private async providerConfigsPillar(): Promise<ReadinessProviderConfigsDto> {
    const rows = await this.prisma.providerConfig.findMany({
      select: { platform: true, isEnabled: true },
    });
    const enabledPlatforms = rows.filter((r) => r.isEnabled).map((r) => r.platform as Platform);
    return {
      configured: rows.length,
      enabled: enabledPlatforms.length,
      enabledPlatforms,
    };
  }

  private async adAccountsPillar(): Promise<ReadinessAdAccountsDto> {
    const rows = await this.prisma.adAccount.findMany({
      where: { deletedAt: null },
      select: { status: true, lastSyncedAt: true },
    });
    const active = rows.filter((r) => r.status === 'ACTIVE').length;
    const errored = rows.filter((r) => r.status === 'ERROR').length;
    const disconnected = rows.filter((r) => r.status === 'DISCONNECTED').length;
    const lastSync = rows
      .map((r) => r.lastSyncedAt)
      .filter((v): v is Date => v !== null && v !== undefined)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const lastSyncedAt = lastSync ? lastSync.toISOString() : null;
    const minutesSinceLastSync = lastSync ? Math.floor((Date.now() - lastSync.getTime()) / 60_000) : null;

    return { total: rows.length, active, errored, disconnected, lastSyncedAt, minutesSinceLastSync };
  }

  private async ingestionPillar(): Promise<ReadinessIngestionDto> {
    const [enabled, intervalHours, latest, snapshotCount] = await Promise.all([
      this.settings.get<boolean>('metrics.ingestion_enabled'),
      this.settings.get<number>('metrics.ingestion_interval_hours'),
      this.prisma.metricSnapshot.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.metricSnapshot.count(),
    ]);

    const lastIngestionAt = latest?.createdAt ? latest.createdAt.toISOString() : null;
    const minutesSinceLastIngestion = latest?.createdAt
      ? Math.floor((Date.now() - latest.createdAt.getTime()) / 60_000)
      : null;

    return {
      enabled: !!enabled,
      intervalHours: intervalHours ?? 6,
      lastIngestionAt,
      minutesSinceLastIngestion,
      snapshotCount,
    };
  }

  private async intelligencePillar(): Promise<ReadinessIntelligenceDto> {
    const [ruleCount, optimizerActionCount, ruleTuningLogCount] = await Promise.all([
      this.prisma.optimizerRule.count(),
      this.prisma.optimizerAction.count(),
      this.prisma.ruleTuningLog.count(),
    ]);
    return { ruleCount, optimizerActionCount, ruleTuningLogCount };
  }

  private async guardrailsPillar(): Promise<ReadinessGuardrailsDto> {
    const [autoTuneRaw, autoApply, suggestOnly, off] = await Promise.all([
      this.safeGet<boolean>('learning.auto_tune_enabled', false),
      this.prisma.campaign.count({ where: { deletedAt: null, optimizerMode: OptimizerMode.AUTO_APPLY } }),
      this.prisma.campaign.count({ where: { deletedAt: null, optimizerMode: OptimizerMode.SUGGEST_ONLY } }),
      this.prisma.campaign.count({ where: { deletedAt: null, optimizerMode: OptimizerMode.OFF } }),
    ]);

    const autoTuneEnabled = !!autoTuneRaw;
    const rolloutSafetyOk = !autoTuneEnabled && autoApply === 0;

    return {
      autoTuneEnabled,
      autoApplyCampaignCount: autoApply,
      suggestOnlyCampaignCount: suggestOnly,
      optimizerOffCampaignCount: off,
      rolloutSafetyOk,
    };
  }

  // AdminSettings.get throws when no compile-time default exists. learning.* keys
  // are owned by RuleTunerService so they're not in the AdminSettingsService DEFAULTS
  // table — fall back to the supplied default rather than leaking the throw.
  private async safeGet<T>(key: string, fallback: T): Promise<T> {
    try {
      return await this.settings.get<T>(key);
    } catch {
      return fallback;
    }
  }
}
