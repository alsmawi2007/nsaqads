import { Injectable, NotFoundException } from '@nestjs/common';
import { AdAccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProviderFactory } from '../providers/factory/provider.factory';
import { refFromAccount } from '../providers/interfaces/ad-account-ref';
import { encrypt } from '../common/utils/crypto.util';
import { ConnectAdAccountDto } from './dto/connect-account.dto';

@Injectable()
export class AdAccountsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private providerFactory: ProviderFactory,
  ) {}

  async connect(orgId: string, userId: string, dto: ConnectAdAccountDto) {
    const encryptedAccessToken = encrypt(dto.accessToken);
    const encryptedRefreshToken = dto.refreshToken ? encrypt(dto.refreshToken) : null;

    const account = await this.prisma.adAccount.create({
      data: {
        orgId,
        platform: dto.platform,
        externalId: dto.externalId,
        name: dto.name,
        currency: dto.currency ?? 'USD',
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        status: AdAccountStatus.ACTIVE,
      },
    });

    await this.audit.log({
      orgId, userId,
      action: 'ad_account.connect',
      resourceType: 'AdAccount', resourceId: account.id,
      afterState: { platform: dto.platform, externalId: dto.externalId },
    });

    return { ...account, accessToken: '[encrypted]', refreshToken: account.refreshToken ? '[encrypted]' : null };
  }

  async findAll(orgId: string) {
    const accounts = await this.prisma.adAccount.findMany({ where: { orgId } });
    return accounts.map((a) => ({ ...a, accessToken: '[encrypted]', refreshToken: a.refreshToken ? '[encrypted]' : null }));
  }

  async findOne(id: string, orgId: string) {
    const account = await this.prisma.adAccount.findFirst({ where: { id, orgId } });
    if (!account) throw new NotFoundException('Ad account not found');
    return { ...account, accessToken: '[encrypted]', refreshToken: account.refreshToken ? '[encrypted]' : null };
  }

  async disconnect(id: string, orgId: string, userId: string) {
    const account = await this.findOne(id, orgId);
    await this.prisma.softDelete('adAccount', id);
    await this.audit.log({
      orgId, userId,
      action: 'ad_account.disconnect',
      resourceType: 'AdAccount', resourceId: id,
      beforeState: { platform: account.platform, externalId: account.externalId },
    });
  }

  async health(id: string, orgId: string): Promise<{
    id: string;
    platform: string;
    status: string;
    tokenExpiresAt: Date | null;
    credentialsValid: boolean;
    lastSyncedAt: Date | null;
    errorMessage: string | null;
  }> {
    const account = await this.prisma.adAccount.findFirst({ where: { id, orgId } });
    if (!account) throw new NotFoundException('Ad account not found');

    const provider = this.providerFactory.getProvider(account.platform);
    let credentialsValid = false;
    let errorMessage = account.errorMessage;
    try {
      credentialsValid = await provider.validateCredentials(refFromAccount(account));
    } catch (err: unknown) {
      credentialsValid = false;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    return {
      id: account.id,
      platform: account.platform,
      status: account.status,
      tokenExpiresAt: account.tokenExpiresAt,
      credentialsValid,
      lastSyncedAt: account.lastSyncedAt,
      errorMessage,
    };
  }

  async sync(id: string, orgId: string, userId: string) {
    const account = await this.prisma.adAccount.findFirstOrThrow({ where: { id, orgId } });
    const provider = this.providerFactory.getProvider(account.platform);

    const campaigns = await provider.fetchCampaigns(refFromAccount(account));

    for (const c of campaigns) {
      await this.prisma.campaign.upsert({
        where: { adAccountId_externalId: { adAccountId: id, externalId: c.externalId } },
        update: {
          name: c.name, status: c.status as never, objective: c.objective,
          dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget,
          isCbo: c.isCbo, syncedAt: new Date(),
        },
        create: {
          orgId, adAccountId: id, externalId: c.externalId, name: c.name,
          platform: account.platform, status: c.status as never,
          objective: c.objective, dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget,
          isCbo: c.isCbo, syncedAt: new Date(),
        },
      });
    }

    await this.prisma.adAccount.update({
      where: { id },
      data: { lastSyncedAt: new Date(), status: AdAccountStatus.ACTIVE, errorMessage: null },
    });

    await this.audit.log({
      orgId, userId,
      action: 'ad_account.sync',
      resourceType: 'AdAccount', resourceId: id,
      afterState: { campaignsSynced: campaigns.length },
    });

    return { synced: campaigns.length };
  }

  // ─── Tracking opt-in ──────────────────────────────────────────────────────
  // Token refresh schedulers and the metrics ingestion cron only operate on
  // accounts where isTracked=true. OAuth pulls every ad account the granted
  // user can manage (can be hundreds) and stores them with isTracked=false
  // so the admin curates which ones the platform should actively work on.

  async setTracked(orgId: string, accountId: string, isTracked: boolean, userId: string) {
    const account = await this.prisma.adAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException('Ad account not found');

    const updated = await this.prisma.adAccount.update({
      where: { id: accountId },
      data:  { isTracked },
    });

    await this.audit.log({
      orgId, userId,
      action: isTracked ? 'ad_account.track' : 'ad_account.untrack',
      resourceType: 'AdAccount', resourceId: accountId,
      beforeState: { isTracked: account.isTracked },
      afterState:  { isTracked },
    });

    return { ...updated, accessToken: '[encrypted]', refreshToken: updated.refreshToken ? '[encrypted]' : null };
  }

  // Bulk variant — flips many accounts in a single transaction. Audit log
  // records the count rather than every id so the entry stays scannable.
  async bulkSetTracked(orgId: string, accountIds: string[], isTracked: boolean, userId: string) {
    const result = await this.prisma.adAccount.updateMany({
      where: { id: { in: accountIds }, orgId },
      data:  { isTracked },
    });

    await this.audit.log({
      orgId, userId,
      action: isTracked ? 'ad_account.bulk_track' : 'ad_account.bulk_untrack',
      resourceType: 'AdAccount',
      afterState: { isTracked, count: result.count, requestedIds: accountIds.length },
    });

    return { updated: result.count };
  }
}
