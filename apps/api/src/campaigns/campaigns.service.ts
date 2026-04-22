import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignPhase, OptimizerMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProviderFactory } from '../providers/factory/provider.factory';

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private providerFactory: ProviderFactory,
  ) {}

  async findAll(orgId: string, filters: { platform?: string; status?: string; phase?: string }) {
    return this.prisma.campaign.findMany({
      where: {
        orgId,
        ...(filters.platform ? { platform: filters.platform as never } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.phase ? { campaignPhase: filters.phase as CampaignPhase } : {}),
      },
      include: { adAccount: { select: { id: true, name: true, currency: true } } },
    });
  }

  async findOne(id: string, orgId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, orgId },
      include: { adAccount: { select: { id: true, name: true, currency: true } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async updateOptimizerSettings(
    id: string,
    orgId: string,
    userId: string,
    data: { optimizerMode?: OptimizerMode; optimizerEnabled?: boolean },
  ) {
    const before = await this.findOne(id, orgId);
    const updated = await this.prisma.campaign.update({ where: { id }, data });
    await this.audit.log({
      orgId, userId,
      action: 'campaign.optimizer_settings_update',
      resourceType: 'Campaign', resourceId: id,
      beforeState: { optimizerMode: before.optimizerMode, optimizerEnabled: before.optimizerEnabled },
      afterState: data,
    });
    return updated;
  }

  async getAdSets(campaignId: string, orgId: string) {
    return this.prisma.adSet.findMany({
      where: { campaignId, orgId },
    });
  }

  async getAdSet(adSetId: string, campaignId: string, orgId: string) {
    const adSet = await this.prisma.adSet.findFirst({ where: { id: adSetId, campaignId, orgId } });
    if (!adSet) throw new NotFoundException('Ad set not found');
    return adSet;
  }

  async syncAdSets(campaignId: string, orgId: string) {
    const campaign = await this.findOne(campaignId, orgId);
    const provider = this.providerFactory.getProvider(campaign.platform);

    const adSets = await provider.fetchAdSets(campaign.adAccountId, campaign.externalId);
    for (const a of adSets) {
      await this.prisma.adSet.upsert({
        where: { campaignId_externalId: { campaignId, externalId: a.externalId } },
        update: {
          name: a.name, status: a.status as never, dailyBudget: a.dailyBudget,
          biddingStrategy: a.biddingStrategy, bidAmount: a.bidAmount,
          bidFloor: a.bidFloor, bidCeiling: a.bidCeiling, syncedAt: new Date(),
        },
        create: {
          orgId, campaignId, externalId: a.externalId, name: a.name,
          status: a.status as never, dailyBudget: a.dailyBudget,
          biddingStrategy: a.biddingStrategy, bidAmount: a.bidAmount,
          bidFloor: a.bidFloor, bidCeiling: a.bidCeiling, syncedAt: new Date(),
        },
      });
    }
    return { synced: adSets.length };
  }
}
