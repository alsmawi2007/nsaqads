import { Injectable, Logger } from '@nestjs/common';
import { ActionStatus, ActionType, OptimizerMode, TriggeredBy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CooldownService } from './cooldown.service';
import { ProviderFactory } from '../providers/factory/provider.factory';
import { ProposedAction } from './dto/proposed-action.dto';
import { BiddingStrategy, UpdateBudgetParams } from '../providers/interfaces/ad-provider.interface';
import { AdAccountRef, refFromAccount } from '../providers/interfaces/ad-account-ref';
export interface ExecutionResult {
  actionId: string;
  status: ActionStatus;
  entityId: string;
  error?: string;
}

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private cooldown: CooldownService,
    private providerFactory: ProviderFactory,
  ) {}

  async execute(
    action: ProposedAction,
    optimizerMode: OptimizerMode,
    triggeredBy: TriggeredBy = TriggeredBy.SCHEDULER,
    triggeredByUserId?: string,
    settings: Record<string, unknown> = {},
  ): Promise<ExecutionResult> {
    // SUGGEST_ONLY mode: write PENDING action but do not call provider
    if (optimizerMode === OptimizerMode.SUGGEST_ONLY) {
      const record = await this.prisma.optimizerAction.create({
        data: {
          orgId: action.orgId,
          ruleId: action.ruleId,
          entityType: action.entityType,
          entityId: action.entityId,
          platform: action.platform,
          actionType: action.actionType,
          beforeValue: { value: action.currentValue } as never,
          afterValue: { value: action.proposedValue } as never,
          status: ActionStatus.PENDING,
          triggeredBy,
          triggeredByUserId,
          explanation: action.explanation as never,
          evaluationContext: { deltaPct: action.deltaPct, targetValue: action.targetValue } as never,
        },
      });
      return { actionId: record.id, status: ActionStatus.PENDING, entityId: action.entityId };
    }

    // AUTO_APPLY mode: call provider
    const adAccount = await this.prisma.adAccount.findUniqueOrThrow({
      where: { id: action.adAccountId },
    });

    let status: ActionStatus = ActionStatus.PENDING;
    let errorMessage: string | undefined;
    let beforeValue: Record<string, unknown> = {};
    let afterValue: Record<string, unknown> = {};

    try {
      const provider = this.providerFactory.getProvider(action.platform);
      const ref = refFromAccount(adAccount);

      // Validate credentials — retry with refresh once
      const credValid = await provider.validateCredentials(ref);
      if (!credValid) {
        await provider.refreshAccessToken(ref);
      }

      // Capture before state
      beforeValue = await this.captureEntityState(action);

      // Call the appropriate provider method
      const providerResult = await this.callProvider(provider, action, ref);

      if (providerResult.success) {
        await this.updateEntityInDb(action);
        afterValue = await this.captureEntityState(action);
        status = ActionStatus.APPLIED;
      } else {
        status = ActionStatus.FAILED;
        errorMessage = providerResult.errorMessage ?? 'Provider returned failure';
      }
    } catch (err: unknown) {
      status = ActionStatus.FAILED;
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Action failed for entity ${action.entityId}: ${errorMessage}`);
    } finally {
      // Always log the action regardless of outcome
      const cooldownHours = settings['optimizer.cooldown_hours'] as number ?? 24;

      const record = await this.prisma.optimizerAction.create({
        data: {
          orgId: action.orgId,
          ruleId: action.ruleId,
          entityType: action.entityType,
          entityId: action.entityId,
          platform: action.platform,
          actionType: action.actionType,
          beforeValue: beforeValue as never,
          afterValue: afterValue as never,
          status,
          appliedAt: status === ActionStatus.APPLIED ? new Date() : undefined,
          errorMessage,
          triggeredBy,
          triggeredByUserId,
          explanation: action.explanation as never,
          evaluationContext: { deltaPct: action.deltaPct, targetValue: action.targetValue } as never,
        },
      });

      await this.audit.log({
        orgId: action.orgId,
        userId: triggeredByUserId,
        action: 'optimizer.action',
        resourceType: action.entityType,
        resourceId: action.entityId,
        beforeState: beforeValue,
        afterState: afterValue,
      });

      // Register cooldown only on successful application
      if (status === ActionStatus.APPLIED) {
        await this.cooldown.registerCooldown(
          action.orgId, action.entityType, action.entityId, action.actionType, cooldownHours,
        );
      }

      return { actionId: record.id, status, entityId: action.entityId, error: errorMessage };
    }
  }

  private async callProvider(provider: ReturnType<ProviderFactory['getProvider']>, action: ProposedAction, ref: AdAccountRef) {
    switch (action.actionType) {
      case ActionType.INCREASE_BUDGET:
      case ActionType.DECREASE_BUDGET: {
        const params: UpdateBudgetParams = {
          entityType: action.entityType,
          externalId: await this.getExternalId(action),
          newDailyBudget: action.proposedValue!,
        };
        return provider.updateBudget(ref, params);
      }
      case ActionType.SWITCH_BIDDING_STRATEGY: {
        return provider.updateBiddingStrategy(ref, {
          adSetExternalId: await this.getExternalId(action),
          newStrategy: action.targetValue as BiddingStrategy,
          newBidAmount: null,
        });
      }
      case ActionType.ADJUST_BID_CEILING:
      case ActionType.ADJUST_BID_FLOOR: {
        return provider.updateBidLimits(ref, {
          adSetExternalId: await this.getExternalId(action),
          newBidFloor: action.actionType === ActionType.ADJUST_BID_FLOOR ? action.proposedValue : null,
          newBidCeiling: action.actionType === ActionType.ADJUST_BID_CEILING ? action.proposedValue : null,
        });
      }
    }
  }

  private async getExternalId(action: ProposedAction): Promise<string> {
    if (action.entityType === 'CAMPAIGN') {
      const c = await this.prisma.campaign.findUniqueOrThrow({ where: { id: action.entityId } });
      return c.externalId;
    }
    const a = await this.prisma.adSet.findUniqueOrThrow({ where: { id: action.entityId } });
    return a.externalId;
  }

  private async captureEntityState(action: ProposedAction): Promise<Record<string, unknown>> {
    if (action.entityType === 'CAMPAIGN') {
      const c = await this.prisma.campaign.findUnique({ where: { id: action.entityId } });
      return { dailyBudget: c?.dailyBudget, status: c?.status };
    }
    const a = await this.prisma.adSet.findUnique({ where: { id: action.entityId } });
    return { dailyBudget: a?.dailyBudget, biddingStrategy: a?.biddingStrategy, bidFloor: a?.bidFloor, bidCeiling: a?.bidCeiling };
  }

  private async updateEntityInDb(action: ProposedAction): Promise<void> {
    if (action.entityType === 'CAMPAIGN' &&
      (action.actionType === ActionType.INCREASE_BUDGET || action.actionType === ActionType.DECREASE_BUDGET)) {
      await this.prisma.campaign.update({
        where: { id: action.entityId },
        data: { dailyBudget: action.proposedValue! },
      });
    } else if (action.entityType === 'AD_SET') {
      const updates: Record<string, unknown> = {};
      if (action.actionType === ActionType.INCREASE_BUDGET || action.actionType === ActionType.DECREASE_BUDGET)
        updates['dailyBudget'] = action.proposedValue;
      if (action.actionType === ActionType.SWITCH_BIDDING_STRATEGY)
        updates['biddingStrategy'] = action.targetValue;
      if (action.actionType === ActionType.ADJUST_BID_CEILING)
        updates['bidCeiling'] = action.proposedValue;
      if (action.actionType === ActionType.ADJUST_BID_FLOOR)
        updates['bidFloor'] = action.proposedValue;

      if (Object.keys(updates).length > 0) {
        await this.prisma.adSet.update({ where: { id: action.entityId }, data: updates });
      }
    }
  }
}
