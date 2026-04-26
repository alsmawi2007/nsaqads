import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BudgetType,
  CampaignGoal,
  CampaignPlanStatus,
  FunnelStage,
} from '@prisma/client';
import { PlanItemResponseDto } from './plan-item-response.dto';
import { RiskFindingDto } from './risk-finding.dto';
import { StrategicSummaryDto } from './strategic-summary.dto';

export class PlanResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orgId: string;

  @ApiProperty({ description: 'User id that created the plan via the wizard.' })
  createdById: string;

  @ApiProperty({ enum: CampaignPlanStatus })
  status: CampaignPlanStatus;

  @ApiProperty({ enum: CampaignGoal })
  goal: CampaignGoal;

  @ApiProperty({ enum: FunnelStage })
  funnelStage: FunnelStage;

  @ApiProperty({ example: 3000 })
  totalBudget: number;

  @ApiProperty({ enum: BudgetType })
  budgetType: BudgetType;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ type: String, format: 'date' })
  startDate: string;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date' })
  endDate: string | null;

  @ApiProperty({
    type: Object,
    description: 'Normalized geography payload (countries, cities, radiusKm).',
  })
  geography: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    type: Object,
    description: 'Optional audience hints captured from the wizard.',
  })
  audienceHints: Record<string, unknown> | null;

  @ApiProperty({
    type: Object,
    description: 'Creative brief payload captured from the wizard.',
  })
  creativeBrief: Record<string, unknown>;

  @ApiProperty({
    type: Object,
    description: 'Original wizard answers kept verbatim for audit / regeneration.',
  })
  wizardAnswers: Record<string, unknown>;

  @ApiProperty({
    type: Object,
    description:
      'Structured decision-engine trace — which rule fired, inputs consumed, chosen output.',
  })
  reasoning: Record<string, unknown>;

  @ApiProperty({ type: StrategicSummaryDto })
  summary: StrategicSummaryDto;

  @ApiProperty({ type: [RiskFindingDto] })
  risks: RiskFindingDto[];

  @ApiProperty({
    description: 'True once the operator explicitly acknowledged all warnings during approve.',
  })
  warningsAcknowledged: boolean;

  @ApiPropertyOptional({ nullable: true })
  approvedById: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  approvedAt: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  launchedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: [PlanItemResponseDto] })
  items: PlanItemResponseDto[];
}
