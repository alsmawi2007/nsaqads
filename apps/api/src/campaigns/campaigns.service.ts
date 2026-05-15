import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignPhase, OptimizerMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProviderFactory } from '../providers/factory/provider.factory';
import { refFromAccount } from '../providers/interfaces/ad-account-ref';

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

  // Testing override: lets ADMIN move a campaign between optimizer phases.
  // Real production transitions happen automatically inside the optimizer
  // pipeline (LEARNING → STABLE once thresholds are met). This endpoint is
  // here so QA can take a freshly-synced campaign out of LEARNING to verify
  // the optimizer reaches it, without faking the underlying metrics.
  //
  // Audited with the user-supplied reason so the override is traceable.
  async setPhase(
    id: string,
    orgId: string,
    userId: string,
    phase: CampaignPhase,
    reason: string,
  ) {
    const before = await this.findOne(id, orgId);
    const updated = await this.prisma.campaign.update({
      where: { id },
      data:  { campaignPhase: phase, phaseUpdatedAt: new Date() },
    });
    await this.audit.log({
      orgId, userId,
      action: 'campaign.phase_override',
      resourceType: 'Campaign', resourceId: id,
      beforeState: { campaignPhase: before.campaignPhase },
      afterState:  { campaignPhase: phase, reason },
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
    const adAccount = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: campaign.adAccountId } });

    const adSets = await provider.fetchAdSets(refFromAccount(adAccount), campaign.externalId);
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
