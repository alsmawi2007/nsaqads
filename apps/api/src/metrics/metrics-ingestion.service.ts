import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderFactory } from '../providers/factory/provider.factory';
import { NormalizedMetrics } from '../providers/interfaces/ad-provider.interface';
import { refFromAccount } from '../providers/interfaces/ad-account-ref';
import { Platform } from '@prisma/client';

@Injectable()
export class MetricsIngestionService {
  private readonly logger = new Logger(MetricsIngestionService.name);

  constructor(private prisma: PrismaService, private providerFactory: ProviderFactory) {}

  async ingestForEntity(
    orgId: string,
    adAccountId: string,
    platform: Platform,
    entityType: 'CAMPAIGN' | 'AD_SET',
    externalId: string,
    entityId: string,
    objective?: string,
  ): Promise<void> {
    const account = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    const ref = refFromAccount(account);
    const provider = this.providerFactory.getProvider(platform);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const windowHours of [24, 48, 72] as const) {
      const exists = await this.prisma.metricSnapshot.findUnique({
        where: { entityType_entityId_snapshotDate_windowHours: { entityType, entityId, snapshotDate: today, windowHours } },
      });

      if (exists) continue; // Already ingested today for this window

      try {
        const metrics = await provider.fetchMetrics(ref, entityType, externalId, windowHours, { objective });
        await this.persistSnapshot(orgId, entityType, entityId, platform, today, windowHours, metrics);
      } catch (err: unknown) {
        this.logger.error(`Failed to ingest ${windowHours}h metrics for ${entityType} ${entityId}: ${err}`);
      }
    }
  }

  private async persistSnapshot(
    orgId: string,
    entityType: string,
    entityId: string,
    platform: Platform,
    snapshotDate: Date,
    windowHours: number,
    m: NormalizedMetrics,
  ): Promise<void> {
    await this.prisma.metricSnapshot.upsert({
      where: { entityType_entityId_snapshotDate_windowHours: { entityType, entityId, snapshotDate, windowHours } },
      update: {
        spend: m.spend, impressions: m.impressions, clicks: m.clicks,
        ctr: m.ctr, cpc: m.cpc, conversions: m.conversions, cpa: m.cpa,
        revenue: m.revenue, roas: m.roas, reach: m.reach, frequency: m.frequency,
        spendPacing: m.spendPacing, rawPayload: m as unknown as never,
      },
      create: {
        orgId, entityType, entityId, platform, snapshotDate, windowHours,
        spend: m.spend, impressions: m.impressions, clicks: m.clicks,
        ctr: m.ctr, cpc: m.cpc, conversions: m.conversions, cpa: m.cpa,
        revenue: m.revenue, roas: m.roas, reach: m.reach, frequency: m.frequency,
        spendPacing: m.spendPacing, rawPayload: m as unknown as never,
      },
    });
  }
}
