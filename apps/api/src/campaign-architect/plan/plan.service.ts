import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CampaignPlanItemLaunchStatus,
  CampaignPlanStatus,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { HllPlanAdjusterService } from '../../historical-learning/scoring/plan-adjuster.service';
import { DecisionEngineService } from '../decision/decision-engine.service';
import { RiskCheckService } from '../risk/risk-check.service';
import { StrategicSummaryService } from '../summary/strategic-summary.service';
import { ApprovePlanDto } from '../dto/approve-plan.dto';
import { PlanResponseDto } from '../dto/plan-response.dto';
import { RiskFindingDto, RiskSeverity } from '../dto/risk-finding.dto';
import { WizardInputDto } from '../dto/wizard-input.dto';
import {
  ConnectedAdAccount,
  DecisionEngineContext,
  PlanDraft,
  PlanItemDraft,
} from '../types';
import { mapPlan, CampaignPlanWithItems } from './plan-mapper';

const PLAN_INCLUDE = { items: true } as const;
const DUPLICATE_DETECTION_WINDOW_MS = 60_000;

export type RegenerateReason = 'user_regenerate' | 'system_update';

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private engine: DecisionEngineService,
    private risk: RiskCheckService,
    private summary: StrategicSummaryService,
    private hllAdjuster: HllPlanAdjusterService,
  ) {}

  async createPlan(
    orgId: string,
    userId: string,
    input: WizardInputDto,
  ): Promise<PlanResponseDto> {
    await this.warnIfDuplicateSubmission(orgId, userId, input);

    const ctx = await this.buildContext(orgId, input);
    const baseDraft = this.engine.build(ctx);
    const draft = await this.hllAdjuster.adjust(orgId, baseDraft);
    const risks = this.risk.evaluate(draft, ctx);
    const summary = this.summary.build(draft);

    const row = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.campaignPlan.create({
        data: {
          orgId,
          createdById: userId,
          status: CampaignPlanStatus.DRAFT,
          goal: draft.goal,
          funnelStage: draft.funnelStage,
          totalBudget: new Prisma.Decimal(draft.totalBudget),
          budgetType: draft.budgetType,
          currency: draft.currency,
          startDate: new Date(draft.startDate),
          endDate: draft.endDate ? new Date(draft.endDate) : null,
          geography: draft.geography as unknown as Prisma.InputJsonValue,
          audienceHints: draft.audienceHints as unknown as Prisma.InputJsonValue,
          creativeBrief: draft.creativeBrief as unknown as Prisma.InputJsonValue,
          wizardAnswers: input as unknown as Prisma.InputJsonValue,
          reasoning: draft.reasoning as unknown as Prisma.InputJsonValue,
          summary: summary as unknown as Prisma.InputJsonValue,
          risks: risks as unknown as Prisma.InputJsonValue,
          warningsAcknowledged: false,
        },
      });

      await tx.campaignPlanItem.createMany({
        data: draft.items.map((item) => this.toItemCreateData(plan.id, item)),
      });

      return tx.campaignPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: PLAN_INCLUDE,
      });
    });

    await this.audit.log({
      orgId,
      userId,
      action: 'campaign_plan.create',
      resourceType: 'CampaignPlan',
      resourceId: row.id,
      afterState: {
        goal: row.goal,
        funnelStage: row.funnelStage,
        platforms: draft.items.map((i) => i.platform),
        risksCount: risks.length,
        blockersCount: risks.filter((r) => r.severity === RiskSeverity.BLOCKER)
          .length,
      },
    });

    return mapPlan(row as CampaignPlanWithItems);
  }

  async getPlan(orgId: string, planId: string): Promise<PlanResponseDto> {
    const row = await this.loadPlan(orgId, planId);
    return mapPlan(row);
  }

  async listPlans(
    orgId: string,
    opts: { status?: CampaignPlanStatus; limit?: number } = {},
  ): Promise<PlanResponseDto[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = await this.prisma.campaignPlan.findMany({
      where: {
        orgId,
        deletedAt: null,
        ...(opts.status ? { status: opts.status } : {}),
      },
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => mapPlan(r as CampaignPlanWithItems));
  }

  async regeneratePlan(
    orgId: string,
    userId: string,
    planId: string,
    reason: RegenerateReason = 'user_regenerate',
  ): Promise<PlanResponseDto> {
    const existing = await this.loadPlan(orgId, planId);

    if (existing.status !== CampaignPlanStatus.DRAFT) {
      throw new ConflictException(
        `Plan ${planId} cannot be regenerated — status is ${existing.status}. Only DRAFT plans may be regenerated.`,
      );
    }

    const input = existing.wizardAnswers as unknown as WizardInputDto;
    const ctx = await this.buildContext(orgId, input);
    const baseDraft = this.engine.build(ctx);
    const draft = await this.hllAdjuster.adjust(orgId, baseDraft, planId);
    const risks = this.risk.evaluate(draft, ctx);
    const summary = this.summary.build(draft);

    const before = {
      reasoning: existing.reasoning,
      summary: existing.summary,
      risks: existing.risks,
      itemCount: existing.items.length,
    };

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.campaignPlanItem.deleteMany({ where: { planId } });
      await tx.campaignPlanItem.createMany({
        data: draft.items.map((item) => this.toItemCreateData(planId, item)),
      });
      await tx.campaignPlan.update({
        where: { id: planId },
        data: {
          goal: draft.goal,
          funnelStage: draft.funnelStage,
          totalBudget: new Prisma.Decimal(draft.totalBudget),
          budgetType: draft.budgetType,
          currency: draft.currency,
          startDate: new Date(draft.startDate),
          endDate: draft.endDate ? new Date(draft.endDate) : null,
          geography: draft.geography as unknown as Prisma.InputJsonValue,
          audienceHints: draft.audienceHints as unknown as Prisma.InputJsonValue,
          creativeBrief: draft.creativeBrief as unknown as Prisma.InputJsonValue,
          reasoning: draft.reasoning as unknown as Prisma.InputJsonValue,
          summary: summary as unknown as Prisma.InputJsonValue,
          risks: risks as unknown as Prisma.InputJsonValue,
          warningsAcknowledged: false,
        },
      });
      return tx.campaignPlan.findUniqueOrThrow({
        where: { id: planId },
        include: PLAN_INCLUDE,
      });
    });

    await this.audit.log({
      orgId,
      userId,
      action: 'campaign_plan.regenerate',
      resourceType: 'CampaignPlan',
      resourceId: planId,
      beforeState: before as unknown as Record<string, unknown>,
      afterState: {
        reason,
        risksCount: risks.length,
        blockersCount: risks.filter((r) => r.severity === RiskSeverity.BLOCKER)
          .length,
        itemCount: draft.items.length,
      },
    });

    return mapPlan(row as CampaignPlanWithItems);
  }

  async approvePlan(
    orgId: string,
    userId: string,
    planId: string,
    dto: ApprovePlanDto,
  ): Promise<PlanResponseDto> {
    const existing = await this.loadPlan(orgId, planId);

    if (existing.status !== CampaignPlanStatus.DRAFT) {
      throw new ConflictException(
        `Plan ${planId} is already ${existing.status}. Only DRAFT plans may be approved.`,
      );
    }

    const risks = (existing.risks as unknown as RiskFindingDto[]) ?? [];
    const blockers = risks.filter((r) => r.severity === RiskSeverity.BLOCKER);
    const warnings = risks.filter((r) => r.severity === RiskSeverity.WARNING);

    if (blockers.length > 0) {
      throw new BadRequestException({
        message:
          'Cannot approve a plan with blocking risks. Resolve blockers and regenerate before approval.',
        blockers: blockers.map((b) => ({ code: b.code, message: b.message })),
      });
    }

    if (warnings.length > 0 && !dto.acknowledgedWarnings) {
      throw new BadRequestException({
        message:
          'This plan has outstanding warnings. Re-submit with acknowledgedWarnings=true to approve.',
        warnings: warnings.map((w) => ({ code: w.code, message: w.message })),
      });
    }

    const now = new Date();
    const row = await this.prisma.campaignPlan.update({
      where: { id: planId },
      data: {
        status: CampaignPlanStatus.APPROVED,
        approvedById: userId,
        approvedAt: now,
        warningsAcknowledged: dto.acknowledgedWarnings,
      },
      include: PLAN_INCLUDE,
    });

    await this.audit.log({
      orgId,
      userId,
      action: 'campaign_plan.approve',
      resourceType: 'CampaignPlan',
      resourceId: planId,
      beforeState: { status: CampaignPlanStatus.DRAFT },
      afterState: {
        status: CampaignPlanStatus.APPROVED,
        warningsAcknowledged: dto.acknowledgedWarnings,
        warningsCount: warnings.length,
      },
    });

    return mapPlan(row as CampaignPlanWithItems);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async loadPlan(
    orgId: string,
    planId: string,
  ): Promise<CampaignPlanWithItems> {
    const row = await this.prisma.campaignPlan.findUnique({
      where: { id: planId },
      include: PLAN_INCLUDE,
    });
    if (!row || row.deletedAt !== null) {
      throw new NotFoundException(`Campaign plan ${planId} not found`);
    }
    if (row.orgId !== orgId) {
      throw new ForbiddenException(
        `Campaign plan ${planId} does not belong to this organization`,
      );
    }
    return row as CampaignPlanWithItems;
  }

  private async buildContext(
    orgId: string,
    input: WizardInputDto,
  ): Promise<DecisionEngineContext> {
    const requestedIds = Object.values(input.platformSelection.adAccountIds);
    const accounts = await this.prisma.adAccount.findMany({
      where: { orgId, id: { in: requestedIds } },
    });
    const connectedAccounts: ConnectedAdAccount[] = accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      currency: a.currency,
      status: a.status,
      deletedAt: a.deletedAt,
    }));
    return {
      input,
      orgSettings: {},
      adAccounts: connectedAccounts,
    };
  }

  private toItemCreateData(
    planId: string,
    item: PlanItemDraft,
  ): Prisma.CampaignPlanItemCreateManyInput {
    return {
      planId,
      platform: item.platform,
      adAccountId: item.adAccountId,
      objective: item.objective,
      dailyBudget: new Prisma.Decimal(item.dailyBudget),
      isCbo: item.isCbo,
      biddingStrategy: item.biddingStrategy,
      bidTarget:
        item.bidTarget !== null ? new Prisma.Decimal(item.bidTarget) : null,
      audience: item.audience as unknown as Prisma.InputJsonValue,
      creativeRef: item.creativeRef as unknown as Prisma.InputJsonValue,
      launchStatus: CampaignPlanItemLaunchStatus.PENDING,
      historyExplanation: item.historyExplanation
        ? (item.historyExplanation as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    };
  }

  private async warnIfDuplicateSubmission(
    orgId: string,
    userId: string,
    input: WizardInputDto,
  ): Promise<void> {
    const since = new Date(Date.now() - DUPLICATE_DETECTION_WINDOW_MS);
    const recent = await this.prisma.campaignPlan.findFirst({
      where: {
        orgId,
        createdById: userId,
        createdAt: { gte: since },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, wizardAnswers: true },
    });
    if (!recent) return;

    const incomingHash = PlanService.hashWizardInput(input);
    const recentHash = PlanService.hashWizardInput(
      recent.wizardAnswers as unknown as WizardInputDto,
    );
    if (incomingHash === recentHash) {
      this.logger.warn(
        `Duplicate plan submission detected for org=${orgId} user=${userId} — matches plan ${recent.id} created within ${DUPLICATE_DETECTION_WINDOW_MS}ms. Proceeding without blocking.`,
      );
    }
  }

  private static hashWizardInput(input: WizardInputDto): string {
    return crypto
      .createHash('sha256')
      .update(PlanService.canonicalJson(input))
      .digest('hex');
  }

  private static canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => PlanService.canonicalJson(v)).join(',')}]`;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (k) =>
        `${JSON.stringify(k)}:${PlanService.canonicalJson(
          (value as Record<string, unknown>)[k],
        )}`,
    );
    return `{${entries.join(',')}}`;
  }

  // Exposed for the future launcher so it can reason over the in-memory shape
  // without re-fetching. Not part of the public controller surface.
  static toPlanDraftSnapshot(plan: PlanResponseDto): Pick<
    PlanDraft,
    'goal' | 'funnelStage' | 'currency'
  > {
    return {
      goal: plan.goal,
      funnelStage: plan.funnelStage,
      currency: plan.currency,
    };
  }
}
