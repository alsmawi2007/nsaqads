import {
  CampaignPlan,
  CampaignPlanItem,
  Prisma,
} from '@prisma/client';
import { PlanItemResponseDto } from '../dto/plan-item-response.dto';
import { PlanResponseDto } from '../dto/plan-response.dto';
import { RiskFindingDto } from '../dto/risk-finding.dto';
import { StrategicSummaryDto } from '../dto/strategic-summary.dto';

type CampaignPlanWithItems = CampaignPlan & { items: CampaignPlanItem[] };

function toIsoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function decimalToNumber(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

export function mapPlanItem(row: CampaignPlanItem): PlanItemResponseDto {
  return {
    id: row.id,
    planId: row.planId,
    platform: row.platform,
    adAccountId: row.adAccountId,
    objective: row.objective,
    dailyBudget: Number(row.dailyBudget),
    isCbo: row.isCbo,
    biddingStrategy: row.biddingStrategy,
    bidTarget: decimalToNumber(row.bidTarget),
    audience: row.audience as Record<string, unknown>,
    creativeRef: row.creativeRef as Record<string, unknown>,
    launchStatus: row.launchStatus,
    externalCampaignId: row.externalCampaignId,
    externalAdsetIds: (row.externalAdsetIds as string[] | null) ?? null,
    errorMessage: row.errorMessage,
    launchedAt: toIsoOrNull(row.launchedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapPlan(row: CampaignPlanWithItems): PlanResponseDto {
  return {
    id: row.id,
    orgId: row.orgId,
    createdById: row.createdById,
    status: row.status,
    goal: row.goal,
    funnelStage: row.funnelStage,
    totalBudget: Number(row.totalBudget),
    budgetType: row.budgetType,
    currency: row.currency,
    startDate: toIsoDate(row.startDate),
    endDate: row.endDate ? toIsoDate(row.endDate) : null,
    geography: row.geography as Record<string, unknown>,
    audienceHints: (row.audienceHints as Record<string, unknown> | null) ?? null,
    creativeBrief: row.creativeBrief as Record<string, unknown>,
    wizardAnswers: row.wizardAnswers as Record<string, unknown>,
    reasoning: row.reasoning as Record<string, unknown>,
    summary: row.summary as unknown as StrategicSummaryDto,
    risks: (row.risks as unknown as RiskFindingDto[]) ?? [],
    warningsAcknowledged: row.warningsAcknowledged,
    approvedById: row.approvedById,
    approvedAt: toIsoOrNull(row.approvedAt),
    launchedAt: toIsoOrNull(row.launchedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map(mapPlanItem),
  };
}

export type { CampaignPlanWithItems };
