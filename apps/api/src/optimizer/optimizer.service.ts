import { Injectable, Logger } from '@nestjs/common';
import { CampaignPhase, OptimizerMode, TriggeredBy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSettingsService } from '../admin/admin-settings.service';
import { EvaluatorService } from './evaluator.service';
import { GuardrailService } from './guardrail.service';
import { ExecutorService } from './executor.service';
import { ProposedAction } from './dto/proposed-action.dto';

export interface CycleResult {
  orgId: string;
  entitiesEvaluated: number;
  actionsApplied: number;
  actionsPending: number;
  actionsSkipped: number;
  actionsFailed: number;
  durationMs: number;
}

@Injectable()
export class OptimizerService {
  private readonly logger = new Logger(OptimizerService.name);

  constructor(
    private prisma: PrismaService,
    private settings: AdminSettingsService,
    private evaluator: EvaluatorService,
    private guardrail: GuardrailService,
    private executor: ExecutorService,
  ) {}

  async runCycleForOrg(orgId: string, triggeredBy: TriggeredBy = TriggeredBy.SCHEDULER, triggeredByUserId?: string): Promise<CycleResult> {
    const start = Date.now();
    this.logger.log(`Starting optimizer cycle for org ${orgId}`);

    // Load merged settings for this org
    const orgSettings = await this.settings.getAll(orgId);

    const enabled = orgSettings['optimizer.enabled'] as boolean ?? true;
    if (!enabled) {
      this.logger.log(`Optimizer disabled for org ${orgId}, skipping`);
      return this.result(orgId, 0, 0, 0, 0, 0, start);
    }

    // Load all optimizer rules: org-level first, then global defaults
    const [orgRules, globalRules] = await Promise.all([
      this.prisma.optimizerRule.findMany({ where: { orgId, isEnabled: true } }),
      this.prisma.optimizerRule.findMany({ where: { orgId: null, isEnabled: true } }),
    ]);
    const allRules = [...orgRules, ...globalRules];

    if (allRules.length === 0) {
      this.logger.log(`No enabled rules for org ${orgId}`);
      return this.result(orgId, 0, 0, 0, 0, 0, start);
    }

    // Fetch active campaigns (excluding LEARNING phase, excluding OFF mode)
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        orgId,
        optimizerEnabled: true,
        campaignPhase: { not: CampaignPhase.LEARNING },
        optimizerMode: { not: OptimizerMode.OFF },
        status: 'ACTIVE',
      },
      include: { adAccount: { select: { id: true, currency: true } } },
    });

    const adSets = await this.prisma.adSet.findMany({
      where: {
        orgId,
        optimizerEnabled: true,
        optimizerMode: { not: OptimizerMode.OFF },
        status: 'ACTIVE',
        campaign: { optimizerEnabled: true, campaignPhase: { not: CampaignPhase.LEARNING } },
      },
      include: {
        campaign: { include: { adAccount: { select: { id: true, currency: true } } } },
      },
    });

    const entitiesEvaluated = campaigns.length + adSets.length;
    let allProposed: ProposedAction[] = [];

    // Evaluate campaigns
    for (const campaign of campaigns) {
      const result = await this.evaluator.evaluateCampaign(campaign as Parameters<EvaluatorService['evaluateCampaign']>[0], allRules);
      allProposed = allProposed.concat(result.proposed);
    }

    // Evaluate ad sets
    for (const adSet of adSets) {
      const result = await this.evaluator.evaluateAdSet(adSet as Parameters<EvaluatorService['evaluateAdSet']>[0], allRules);
      allProposed = allProposed.concat(result.proposed);
    }

    // Guardrail validation
    const { approved, skipped } = await this.guardrail.validate(allProposed, orgSettings);

    let actionsApplied = 0;
    let actionsPending = 0;
    let actionsFailed = 0;

    // Execute approved actions
    for (const action of approved) {
      // Determine mode for this specific entity
      const mode = await this.getEntityMode(action.entityType, action.entityId);

      const result = await this.executor.execute(action, mode, triggeredBy, triggeredByUserId, orgSettings);

      if (result.status === 'APPLIED') actionsApplied++;
      else if (result.status === 'PENDING') actionsPending++;
      else if (result.status === 'FAILED') actionsFailed++;
    }

    const cycleResult = this.result(
      orgId, entitiesEvaluated, actionsApplied, actionsPending, skipped.length, actionsFailed, start,
    );

    this.logger.log(
      `Cycle complete for org ${orgId}: ${entitiesEvaluated} evaluated, ` +
      `${actionsApplied} applied, ${actionsPending} pending, ${skipped.length} skipped, ${actionsFailed} failed ` +
      `in ${cycleResult.durationMs}ms`,
    );

    return cycleResult;
  }

  async simulateCycleForOrg(orgId: string): Promise<{ approved: ProposedAction[]; skipped: Array<{ action: ProposedAction; reason: string }> }> {
    const orgSettings = await this.settings.getAll(orgId);

    const [orgRules, globalRules] = await Promise.all([
      this.prisma.optimizerRule.findMany({ where: { orgId, isEnabled: true } }),
      this.prisma.optimizerRule.findMany({ where: { orgId: null, isEnabled: true } }),
    ]);
    const allRules = [...orgRules, ...globalRules];

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        orgId,
        optimizerEnabled: true,
        campaignPhase: { not: CampaignPhase.LEARNING },
        optimizerMode: { not: OptimizerMode.OFF },
        status: 'ACTIVE',
      },
      include: { adAccount: { select: { id: true, currency: true } } },
    });

    const adSets = await this.prisma.adSet.findMany({
      where: {
        orgId,
        optimizerEnabled: true,
        optimizerMode: { not: OptimizerMode.OFF },
        status: 'ACTIVE',
        campaign: { optimizerEnabled: true, campaignPhase: { not: CampaignPhase.LEARNING } },
      },
      include: {
        campaign: { include: { adAccount: { select: { id: true, currency: true } } } },
      },
    });

    let allProposed: ProposedAction[] = [];

    for (const campaign of campaigns) {
      const result = await this.evaluator.evaluateCampaign(campaign as Parameters<EvaluatorService['evaluateCampaign']>[0], allRules);
      allProposed = allProposed.concat(result.proposed);
    }

    for (const adSet of adSets) {
      const result = await this.evaluator.evaluateAdSet(adSet as Parameters<EvaluatorService['evaluateAdSet']>[0], allRules);
      allProposed = allProposed.concat(result.proposed);
    }

    // Run guardrail validation — no executor call, no DB writes
    return this.guardrail.validate(allProposed, orgSettings);
  }

  private async getEntityMode(entityType: string, entityId: string): Promise<OptimizerMode> {
    if (entityType === 'CAMPAIGN') {
      const c = await this.prisma.campaign.findUnique({ where: { id: entityId }, select: { optimizerMode: true, campaignPhase: true } });
      // LEARNING and DEGRADED phases always use SUGGEST_ONLY regardless of stored mode
      if (c?.campaignPhase === CampaignPhase.LEARNING || c?.campaignPhase === CampaignPhase.DEGRADED) {
        return OptimizerMode.SUGGEST_ONLY;
      }
      return c?.optimizerMode ?? OptimizerMode.SUGGEST_ONLY;
    }
    const a = await this.prisma.adSet.findUnique({ where: { id: entityId }, select: { optimizerMode: true } });
    return a?.optimizerMode ?? OptimizerMode.SUGGEST_ONLY;
  }

  private result(
    orgId: string, entitiesEvaluated: number, actionsApplied: number,
    actionsPending: number, actionsSkipped: number, actionsFailed: number, startMs: number,
  ): CycleResult {
    return {
      orgId, entitiesEvaluated, actionsApplied, actionsPending, actionsSkipped, actionsFailed,
      durationMs: Date.now() - startMs,
    };
  }
}
