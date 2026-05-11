import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignPlan,
  CampaignPlanItem,
  CampaignPlanItemLaunchStatus,
  CampaignPlanStatus,
  Platform,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ProviderFactory } from '../../providers/factory/provider.factory';
import {
  BiddingStrategy,
  CreativeDraft,
  IAdProvider,
  NormalizedAdDraft,
  NormalizedAdSetDraft,
  NormalizedAudience,
  NormalizedCampaignDraft,
  ProviderActionResult,
} from '../../providers/interfaces/ad-provider.interface';
import { AdAccountRef } from '../../providers/interfaces/ad-account-ref';
import {
  LaunchProgressSummaryDto,
  LaunchResultDto,
  LaunchResultItemDto,
} from '../dto/launch-result.dto';
import { RiskFindingDto, RiskSeverity } from '../dto/risk-finding.dto';
import { CreativeRef } from '../types';

type CampaignPlanWithItems = CampaignPlan & { items: CampaignPlanItem[] };

const ITEM_LAUNCH_TIMEOUT_MS = 30_000;

interface ItemOutcome {
  item: CampaignPlanItem;
  status: CampaignPlanItemLaunchStatus;
  externalCampaignId: string | null;
  externalAdsetIds: string[] | null;
  externalCreativeId: string | null;
  externalAdId: string | null;
  errorMessage: string | null;
  launchedAt: Date | null;
}

@Injectable()
export class LauncherService {
  private readonly logger = new Logger(LauncherService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private providers: ProviderFactory,
  ) {}

  async launchPlan(
    orgId: string,
    userId: string,
    planId: string,
  ): Promise<LaunchResultDto> {
    const plan = await this.loadPlanForLaunch(orgId, planId);

    this.assertNoBlockers(plan);

    if (plan.status === CampaignPlanStatus.LAUNCHED) {
      throw new ConflictException(
        `Plan ${planId} is already LAUNCHED. Use a fresh plan to relaunch.`,
      );
    }
    if (plan.status === CampaignPlanStatus.FAILED) {
      throw new ConflictException(
        `Plan ${planId} is in FAILED state. Regenerate or create a new plan to retry.`,
      );
    }
    if (
      plan.status !== CampaignPlanStatus.APPROVED &&
      plan.status !== CampaignPlanStatus.LAUNCHING
    ) {
      throw new ConflictException(
        `Plan ${planId} cannot be launched — status is ${plan.status}. Approve the plan first.`,
      );
    }

    if (plan.items.length === 0) {
      throw new BadRequestException(
        `Plan ${planId} has no items to launch.`,
      );
    }

    const launchStartedAt = Date.now();

    if (plan.status === CampaignPlanStatus.APPROVED) {
      await this.prisma.campaignPlan.update({
        where: { id: planId },
        data: { status: CampaignPlanStatus.LAUNCHING },
      });
    }

    await this.audit.log({
      orgId,
      userId,
      action: 'campaign_plan.launch_started',
      resourceType: 'CampaignPlan',
      resourceId: planId,
      beforeState: { status: plan.status },
      afterState: {
        status: CampaignPlanStatus.LAUNCHING,
        itemCount: plan.items.length,
        platforms: plan.items.map((i) => i.platform),
      },
    });

    const adAccountMap = await this.loadAdAccounts(orgId, plan.items);

    const outcomes: ItemOutcome[] = [];
    for (const item of plan.items) {
      const outcome = await this.launchItem(orgId, userId, plan, item, adAccountMap);
      outcomes.push(outcome);
    }

    const createdCount = outcomes.filter(
      (o) => o.status === CampaignPlanItemLaunchStatus.CREATED,
    ).length;
    const failedCount = outcomes.filter(
      (o) => o.status === CampaignPlanItemLaunchStatus.FAILED,
    ).length;
    const skippedCount = outcomes.filter(
      (o) => o.status === CampaignPlanItemLaunchStatus.SKIPPED,
    ).length;

    let finalStatus: CampaignPlanStatus;
    if (createdCount > 0) {
      finalStatus = CampaignPlanStatus.LAUNCHED;
    } else {
      finalStatus = CampaignPlanStatus.FAILED;
    }

    const finalLaunchedAt = finalStatus === CampaignPlanStatus.LAUNCHED ? new Date() : null;
    await this.prisma.campaignPlan.update({
      where: { id: planId },
      data: {
        status: finalStatus,
        launchedAt: finalLaunchedAt,
      },
    });

    await this.audit.log({
      orgId,
      userId,
      action:
        finalStatus === CampaignPlanStatus.LAUNCHED
          ? 'campaign_plan.launched'
          : 'campaign_plan.launch_failed',
      resourceType: 'CampaignPlan',
      resourceId: planId,
      beforeState: { status: CampaignPlanStatus.LAUNCHING },
      afterState: {
        status: finalStatus,
        createdCount,
        failedCount,
        skippedCount,
        totalItems: plan.items.length,
      },
    });

    const durationMs = Date.now() - launchStartedAt;
    const summary = this.buildSummary(
      plan.items.length,
      createdCount,
      failedCount,
      skippedCount,
      durationMs,
      finalStatus,
    );

    return {
      planId,
      planStatus: finalStatus,
      launchedAt: finalLaunchedAt ? finalLaunchedAt.toISOString() : null,
      totalItems: plan.items.length,
      createdCount,
      failedCount,
      skippedCount,
      summary,
      items: outcomes.map((o) => this.toResultItem(o)),
    };
  }

  private buildSummary(
    totalItems: number,
    createdCount: number,
    failedCount: number,
    skippedCount: number,
    durationMs: number,
    finalStatus: CampaignPlanStatus,
  ): LaunchProgressSummaryDto {
    const handled = createdCount + failedCount + skippedCount;
    const progressPct = totalItems === 0 ? 0 : Math.round((handled / totalItems) * 100);
    const successRate = totalItems === 0 ? 0 : Math.round((createdCount / totalItems) * 100);

    let message: string;
    if (finalStatus === CampaignPlanStatus.LAUNCHED && failedCount === 0) {
      message = `Launched ${createdCount}/${totalItems} items successfully (${successRate}%) in ${durationMs}ms.`;
    } else if (finalStatus === CampaignPlanStatus.LAUNCHED && failedCount > 0) {
      message = `Partially launched: ${createdCount} created, ${failedCount} failed of ${totalItems} (${successRate}% success) in ${durationMs}ms.`;
    } else {
      message = `Launch failed: 0/${totalItems} items created, ${failedCount} failed in ${durationMs}ms.`;
    }

    return { progressPct, successRate, durationMs, message };
  }

  // ─── Per-item launch ─────────────────────────────────────────────────────

  private async launchItem(
    orgId: string,
    userId: string,
    plan: CampaignPlan,
    item: CampaignPlanItem,
    adAccountMap: Map<string, { ref: AdAccountRef; status: string }>,
  ): Promise<ItemOutcome> {
    if (item.launchStatus === CampaignPlanItemLaunchStatus.CREATED) {
      return {
        item,
        status: CampaignPlanItemLaunchStatus.SKIPPED,
        externalCampaignId: item.externalCampaignId,
        externalAdsetIds: this.parseExternalAdsetIds(item.externalAdsetIds),
        externalCreativeId: null,
        externalAdId: null,
        errorMessage: null,
        launchedAt: item.launchedAt,
      };
    }

    const before = {
      launchStatus: item.launchStatus,
      externalCampaignId: item.externalCampaignId,
      externalAdsetIds: item.externalAdsetIds,
    };

    await this.prisma.campaignPlanItem.update({
      where: { id: item.id },
      data: {
        launchStatus: CampaignPlanItemLaunchStatus.CREATING,
        errorMessage: null,
      },
    });

    let externalCampaignId: string | null = item.externalCampaignId;
    let externalAdsetIds: string[] | null = this.parseExternalAdsetIds(
      item.externalAdsetIds,
    );
    let externalCreativeId: string | null = null;
    let externalAdId: string | null = null;
    let errorMessage: string | null = null;
    let status: CampaignPlanItemLaunchStatus = CampaignPlanItemLaunchStatus.CREATING;

    try {
      const result = await this.withTimeout(
        this.runItemPipeline(orgId, plan, item, adAccountMap, externalCampaignId, externalAdsetIds),
        ITEM_LAUNCH_TIMEOUT_MS,
        `Item ${item.id} (${item.platform}) launch exceeded ${ITEM_LAUNCH_TIMEOUT_MS}ms timeout.`,
      );
      externalCampaignId = result.externalCampaignId;
      externalAdsetIds = result.externalAdsetIds;
      externalCreativeId = result.externalCreativeId;
      externalAdId = result.externalAdId;
      status = CampaignPlanItemLaunchStatus.CREATED;
    } catch (err) {
      status = CampaignPlanItemLaunchStatus.FAILED;
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Item ${item.id} (${item.platform}) launch failed: ${errorMessage}`,
      );
    }

    const launchedAt = status === CampaignPlanItemLaunchStatus.CREATED ? new Date() : null;

    const updated = await this.prisma.campaignPlanItem.update({
      where: { id: item.id },
      data: {
        launchStatus: status,
        externalCampaignId,
        externalAdsetIds:
          externalAdsetIds !== null
            ? (externalAdsetIds as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        errorMessage,
        launchedAt,
      },
    });

    await this.audit.log({
      orgId,
      userId,
      action: 'campaign_plan_item.launch',
      resourceType: 'CampaignPlanItem',
      resourceId: item.id,
      beforeState: before,
      afterState: {
        launchStatus: status,
        externalCampaignId,
        externalAdsetIds,
        externalCreativeId,
        externalAdId,
        errorMessage,
        platform: item.platform,
      },
    });

    return {
      item: updated,
      status,
      externalCampaignId,
      externalAdsetIds,
      externalCreativeId,
      externalAdId,
      errorMessage,
      launchedAt,
    };
  }

  private async runItemPipeline(
    orgId: string,
    plan: CampaignPlan,
    item: CampaignPlanItem,
    adAccountMap: Map<string, { ref: AdAccountRef; status: string }>,
    initialExternalCampaignId: string | null,
    initialExternalAdsetIds: string[] | null,
  ): Promise<{
    externalCampaignId: string;
    externalAdsetIds: string[];
    externalCreativeId: string;
    externalAdId: string;
  }> {
    const adAccount = adAccountMap.get(item.adAccountId);
    if (!adAccount) {
      throw new Error(
        `Ad account ${item.adAccountId} not found or not active for org ${orgId}.`,
      );
    }
    const ref = adAccount.ref;
    const provider: IAdProvider = this.providers.getProvider(item.platform);

    const credsValid = await provider.validateCredentials(ref);
    if (!credsValid) {
      throw new Error(
        `Provider credentials invalid for ${item.platform} account ${ref.externalId}.`,
      );
    }

    let externalCampaignId = initialExternalCampaignId;
    let externalAdsetIds = initialExternalAdsetIds;

    // 1. Campaign — skip if already created
    if (!externalCampaignId) {
      const campaignDraft = this.buildCampaignDraft(plan, item);
      const result = await provider.createCampaign(ref, campaignDraft);
      this.assertProviderSuccess(result, 'createCampaign');
      externalCampaignId = result.externalId;
    } else {
      this.logger.log(
        `Item ${item.id}: skipping createCampaign (externalCampaignId=${externalCampaignId}).`,
      );
    }

    // 2. Ad set — skip if any external adset id already recorded
    let adSetExternalId: string;
    if (externalAdsetIds && externalAdsetIds.length > 0) {
      adSetExternalId = externalAdsetIds[0];
      this.logger.log(
        `Item ${item.id}: skipping createAdSet (externalAdsetId=${adSetExternalId}).`,
      );
    } else {
      const adSetDraft = this.buildAdSetDraft(plan, item, externalCampaignId);
      const result = await provider.createAdSet(ref, adSetDraft);
      this.assertProviderSuccess(result, 'createAdSet');
      adSetExternalId = result.externalId;
      externalAdsetIds = [adSetExternalId];
    }

    // 3. Creative — always uploaded; deterministic mock IDs make this safe.
    // Real providers would persist externalCreativeId on the item; in the
    // MVP launcher we accept the re-call cost on retry.
    const creativeDraft = this.buildCreativeDraft(item);
    const creativeResult = await provider.uploadCreative(ref, creativeDraft);
    this.assertProviderSuccess(creativeResult, 'uploadCreative');
    const externalCreativeId = creativeResult.externalId;

    // 4. Ad
    const adDraft: NormalizedAdDraft = {
      adSetExternalId,
      creativeExternalId: externalCreativeId,
      name: this.adName(plan, item),
      status: 'PAUSED',
    };
    const adResult = await provider.createAd(ref, adDraft);
    this.assertProviderSuccess(adResult, 'createAd');
    const externalAdId = adResult.externalId;

    return {
      externalCampaignId,
      externalAdsetIds,
      externalCreativeId,
      externalAdId,
    };
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    errMessage: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(errMessage)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  // ─── Draft builders ──────────────────────────────────────────────────────

  private buildCampaignDraft(
    plan: CampaignPlan,
    item: CampaignPlanItem,
  ): NormalizedCampaignDraft {
    const isDaily = plan.budgetType === 'DAILY';
    return {
      name: this.campaignName(plan, item),
      objective: item.objective,
      status: 'PAUSED',
      dailyBudget: item.isCbo && isDaily ? Number(item.dailyBudget) : null,
      lifetimeBudget:
        item.isCbo && !isDaily ? Number(plan.totalBudget) : null,
      isCbo: item.isCbo,
      startDate: this.toIsoDate(plan.startDate),
      endDate: plan.endDate ? this.toIsoDate(plan.endDate) : null,
    };
  }

  private buildAdSetDraft(
    plan: CampaignPlan,
    item: CampaignPlanItem,
    campaignExternalId: string,
  ): NormalizedAdSetDraft {
    const audience = item.audience as unknown as NormalizedAudience;
    return {
      campaignExternalId,
      name: this.adSetName(plan, item),
      status: 'PAUSED',
      dailyBudget: item.isCbo ? null : Number(item.dailyBudget),
      biddingStrategy: item.biddingStrategy as BiddingStrategy,
      bidAmount: item.bidTarget !== null ? Number(item.bidTarget) : null,
      bidFloor: null,
      bidCeiling: null,
      audience,
      startDate: this.toIsoDate(plan.startDate),
      endDate: plan.endDate ? this.toIsoDate(plan.endDate) : null,
    };
  }

  private buildCreativeDraft(item: CampaignPlanItem): CreativeDraft {
    const ref = item.creativeRef as unknown as CreativeRef;
    return {
      name: `${item.platform.toLowerCase()}-creative-${item.id.slice(0, 8)}`,
      assetRefs: ref.assetRefs.length > 0 ? ref.assetRefs : ['placeholder-asset'],
      headline: ref.headline,
      description: ref.description,
      cta: ref.cta,
      landingUrl: ref.landingUrl,
    };
  }

  // ─── Naming helpers ──────────────────────────────────────────────────────

  private campaignName(plan: CampaignPlan, item: CampaignPlanItem): string {
    return `Nasaq Ads ${plan.goal} ${item.platform} ${plan.id.slice(0, 8)}`;
  }

  private adSetName(plan: CampaignPlan, item: CampaignPlanItem): string {
    return `Nasaq Ads ${plan.goal} ${item.platform} adset ${plan.id.slice(0, 8)}`;
  }

  private adName(plan: CampaignPlan, item: CampaignPlanItem): string {
    return `Nasaq Ads ${plan.goal} ${item.platform} ad ${plan.id.slice(0, 8)}`;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async loadPlanForLaunch(
    orgId: string,
    planId: string,
  ): Promise<CampaignPlanWithItems> {
    const row = await this.prisma.campaignPlan.findUnique({
      where: { id: planId },
      include: { items: true },
    });
    if (!row || row.deletedAt !== null) {
      throw new NotFoundException(`Campaign plan ${planId} not found`);
    }
    if (row.orgId !== orgId) {
      throw new ForbiddenException(
        `Campaign plan ${planId} does not belong to this organization`,
      );
    }
    return row;
  }

  private async loadAdAccounts(
    orgId: string,
    items: CampaignPlanItem[],
  ): Promise<Map<string, { ref: AdAccountRef; status: string }>> {
    const ids = Array.from(new Set(items.map((i) => i.adAccountId)));
    const rows = await this.prisma.adAccount.findMany({
      where: { orgId, id: { in: ids } },
    });
    const map = new Map<string, { ref: AdAccountRef; status: string }>();
    for (const row of rows) {
      if (row.deletedAt !== null) continue;
      map.set(row.id, {
        ref: { id: row.id, externalId: row.externalId, platform: row.platform },
        status: row.status,
      });
    }
    return map;
  }

  private assertNoBlockers(plan: CampaignPlan): void {
    const risks = (plan.risks as unknown as RiskFindingDto[]) ?? [];
    const blockers = risks.filter((r) => r.severity === RiskSeverity.BLOCKER);
    if (blockers.length > 0) {
      throw new BadRequestException({
        message:
          'Plan still has blocking risks and cannot be launched. Regenerate the plan to clear them.',
        blockers: blockers.map((b) => ({ code: b.code, message: b.message })),
      });
    }
  }

  private assertProviderSuccess(
    result: ProviderActionResult,
    step: string,
  ): void {
    if (!result.success) {
      const code = result.errorCode ?? 'UNKNOWN';
      const msg = result.errorMessage ?? 'no message';
      throw new Error(`${step} failed [${code}]: ${msg}`);
    }
  }

  private parseExternalAdsetIds(value: Prisma.JsonValue | null): string[] | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string');
    }
    return null;
  }

  private toIsoDate(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  private toResultItem(o: ItemOutcome): LaunchResultItemDto {
    return {
      itemId: o.item.id,
      platform: o.item.platform as Platform,
      launchStatus: o.status,
      externalCampaignId: o.externalCampaignId,
      externalAdsetIds: o.externalAdsetIds,
      externalCreativeId: o.externalCreativeId,
      externalAdId: o.externalAdId,
      errorMessage: o.errorMessage,
      launchedAt: o.launchedAt ? o.launchedAt.toISOString() : null,
    };
  }
}
