import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CampaignPlanStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApprovePlanDto } from './dto/approve-plan.dto';
import { LaunchResultDto } from './dto/launch-result.dto';
import { PlanResponseDto } from './dto/plan-response.dto';
import { WizardInputDto } from './dto/wizard-input.dto';
import { LauncherService } from './launcher/launcher.service';
import { PlanService } from './plan/plan.service';

@ApiTags('Campaign Architect')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/campaign-plans')
export class CampaignArchitectController {
  constructor(
    private readonly plans: PlanService,
    private readonly launcher: LauncherService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new campaign plan from wizard input',
    description:
      'Runs the rule-based decision engine, risk check, and strategic summary, then persists a DRAFT plan. Does not launch anything.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiBody({ type: WizardInputDto })
  @ApiResponse({ status: 201, type: PlanResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failure on wizard input' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'User is not a member of this organization' })
  createPlan(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
    @Body() input: WizardInputDto,
  ): Promise<PlanResponseDto> {
    return this.plans.createPlan(orgId, user.sub, input);
  }

  @Get()
  @ApiOperation({
    summary: 'List campaign plans for the organization',
    description: 'Newest first. Optional status filter and limit.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiQuery({ name: 'status', required: false, enum: CampaignPlanStatus })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Default 50, max 200',
  })
  @ApiResponse({ status: 200, type: [PlanResponseDto] })
  @ApiResponse({ status: 403, description: 'Not a member of this organization' })
  listPlans(
    @Param('orgId') orgId: string,
    @Query('status') status?: CampaignPlanStatus,
    @Query('limit') limit?: string,
  ): Promise<PlanResponseDto[]> {
    return this.plans.listPlans(orgId, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single campaign plan with all items' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Campaign plan UUID' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  @ApiResponse({ status: 403, description: 'Plan does not belong to this organization' })
  @ApiResponse({ status: 404, description: 'Plan not found or soft-deleted' })
  getPlan(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<PlanResponseDto> {
    return this.plans.getPlan(orgId, id);
  }

  @Post(':id/regenerate')
  @ApiOperation({
    summary: 'Regenerate a DRAFT plan from its original wizard input',
    description:
      'Re-runs the decision engine, risk check, and summary, then replaces the plan items. Plan must be in DRAFT status; resets warningsAcknowledged to false.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Campaign plan UUID' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Plan is not in DRAFT status (e.g. already APPROVED or LAUNCHED)',
  })
  @ApiResponse({ status: 403, description: 'Plan does not belong to this organization' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  regeneratePlan(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
  ): Promise<PlanResponseDto> {
    return this.plans.regeneratePlan(orgId, user.sub, id, 'user_regenerate');
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve a DRAFT plan',
    description:
      'Transitions the plan from DRAFT to APPROVED. Returns 400 if there are BLOCKER risks or unacknowledged warnings.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Campaign plan UUID' })
  @ApiBody({ type: ApprovePlanDto })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Plan has BLOCKER risks, or has WARNING risks without acknowledgedWarnings=true.',
  })
  @ApiResponse({
    status: 409,
    description: 'Plan is not in DRAFT status',
  })
  @ApiResponse({ status: 403, description: 'Plan does not belong to this organization' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  approvePlan(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() dto: ApprovePlanDto,
  ): Promise<PlanResponseDto> {
    return this.plans.approvePlan(orgId, user.sub, id, dto);
  }

  @Post(':id/launch')
  @ApiOperation({
    summary: 'Launch an APPROVED plan into the provider layer',
    description:
      'Calls the provider chain (createCampaign → createAdSet → uploadCreative → createAd) for each plan item. Currently uses MockProvider for all platforms; per-item failures are isolated and partial success transitions the plan to LAUNCHED. Idempotent: items already CREATED are skipped, persisted external IDs short-circuit upstream provider calls.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Campaign plan UUID' })
  @ApiResponse({ status: 200, type: LaunchResultDto })
  @ApiResponse({
    status: 400,
    description:
      'Plan still has BLOCKER risks, or has zero items.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Plan is not launchable (must be APPROVED or LAUNCHING; LAUNCHED/FAILED are terminal).',
  })
  @ApiResponse({ status: 403, description: 'Plan does not belong to this organization' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  launchPlan(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
  ): Promise<LaunchResultDto> {
    return this.launcher.launchPlan(orgId, user.sub, id);
  }
}
