import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, HttpCode, HttpStatus, Query,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery,
} from '@nestjs/swagger';
import { MemberRole, TriggeredBy } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptimizerService } from './optimizer.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@ApiTags('Optimizer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/optimizer')
export class OptimizerController {
  constructor(
    private optimizer: OptimizerService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get('rules')
  @ApiOperation({ summary: 'List optimizer rules (org overrides + global defaults)' })
  async listRules(@Param('orgId') orgId: string) {
    const [orgRules, globalRules] = await Promise.all([
      this.prisma.optimizerRule.findMany({ where: { orgId } }),
      this.prisma.optimizerRule.findMany({ where: { orgId: null } }),
    ]);
    return { orgRules, globalRules };
  }

  @Post('rules')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Create an org-level optimizer rule (ADMIN+)' })
  async createRule(@Param('orgId') orgId: string, @Body() body: Record<string, unknown>) {
    return this.prisma.optimizerRule.create({ data: { ...body, orgId } as never });
  }

  @Patch('rules/:ruleId')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Update an org-level optimizer rule (ADMIN+)' })
  updateRule(@Param('ruleId') ruleId: string, @Body() body: Record<string, unknown>) {
    return this.prisma.optimizerRule.update({ where: { id: ruleId }, data: body as never });
  }

  @Delete('rules/:ruleId')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an org-level optimizer rule (ADMIN+)' })
  deleteRule(@Param('ruleId') ruleId: string) {
    return this.prisma.optimizerRule.delete({ where: { id: ruleId } });
  }

  @Get('actions')
  @ApiOperation({ summary: 'List optimizer action history (enriched with entity names)' })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async listActions(
    @Param('orgId') orgId: string,
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
  ) {
    const actions = await this.prisma.optimizerAction.findMany({
      where: {
        orgId,
        ...(entityId ? { entityId } : {}),
        ...(status ? { status: status as never } : {}),
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      take: parseInt(limit, 10),
      orderBy: { createdAt: 'desc' },
      include: { rule: { select: { id: true, name: true } } },
    });

    // Resolve entity names (campaign or ad set) for display
    const campaignIds = actions.filter((a) => a.entityType === 'CAMPAIGN').map((a) => a.entityId);
    const adSetIds    = actions.filter((a) => a.entityType === 'AD_SET').map((a) => a.entityId);

    const [campaigns, adSets] = await Promise.all([
      campaignIds.length
        ? this.prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } })
        : [],
      adSetIds.length
        ? this.prisma.adSet.findMany({
            where: { id: { in: adSetIds } },
            select: { id: true, name: true, campaign: { select: { id: true, name: true } } },
          })
        : [],
    ]);

    const campaignMap = new Map(campaigns.map((c) => [c.id, c.name]));
    const adSetMap    = new Map(adSets.map((s) => [s.id, s]));

    return actions.map((a) => {
      const isAdSet     = a.entityType === 'AD_SET';
      const adSet       = isAdSet ? adSetMap.get(a.entityId) : undefined;
      const campaignId  = isAdSet ? adSet?.campaign.id  : a.entityId;
      const campaignName = isAdSet ? adSet?.campaign.name : campaignMap.get(a.entityId);

      return {
        ...a,
        campaignId:   campaignId  ?? a.entityId,
        campaignName: campaignName ?? '—',
        adSetId:      isAdSet ? a.entityId : null,
        adSetName:    adSet?.name ?? null,
        ruleName:     a.rule?.name ?? null,
        before:       a.beforeValue,
        after:        a.afterValue,
      };
    });
  }

  @Get('actions/:actionId')
  @ApiOperation({ summary: 'Get a specific optimizer action with full context' })
  getAction(@Param('actionId') actionId: string) {
    return this.prisma.optimizerAction.findUniqueOrThrow({
      where: { id: actionId },
      include: { rule: true },
    });
  }

  @Post('actions/:actionId/approve')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Approve a PENDING (SUGGEST_ONLY) optimizer action (ADMIN+)' })
  async approveAction(
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @CurrentUser() user: { sub: string },
  ) {
    const action = await this.prisma.optimizerAction.findUniqueOrThrow({ where: { id: actionId } });
    if (action.status !== 'PENDING') throw new Error('Action is not in PENDING state');

    const updated = await this.prisma.optimizerAction.update({
      where: { id: actionId },
      data: { status: 'APPLIED', appliedAt: new Date(), triggeredBy: TriggeredBy.MANUAL, triggeredByUserId: user.sub },
    });

    await this.audit.log({
      orgId, userId: user.sub,
      action: 'optimizer.action.approve',
      resourceType: action.entityType,
      resourceId: action.entityId,
    });

    return updated;
  }

  @Post('actions/:actionId/reject')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject a PENDING optimizer action (ADMIN+)' })
  async rejectAction(
    @Param('orgId') orgId: string,
    @Param('actionId') actionId: string,
    @CurrentUser() user: { sub: string },
  ) {
    await this.prisma.optimizerAction.update({
      where: { id: actionId },
      data: { status: 'SKIPPED', triggeredByUserId: user.sub },
    });
  }

  @Post('run')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Manually trigger an optimizer cycle (ADMIN+)' })
  async run(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.optimizer.runCycleForOrg(orgId, TriggeredBy.MANUAL, user.sub);
  }

  @Post('simulate')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Simulate optimizer cycle — returns proposed actions without applying any changes (ADMIN+)' })
  @ApiResponse({ status: 200, description: 'Enriched SimulateResult[] for the org, with no DB writes or provider calls' })
  async simulate(@Param('orgId') orgId: string) {
    const { approved } = await this.optimizer.simulateCycleForOrg(orgId);

    if (approved.length === 0) return [];

    const campaignIds = [...new Set(approved.filter((a) => a.entityType === 'CAMPAIGN').map((a) => a.entityId))];
    const adSetIds    = [...new Set(approved.filter((a) => a.entityType === 'AD_SET').map((a) => a.entityId))];
    const ruleIds     = [...new Set(approved.map((a) => a.ruleId).filter((x): x is string => !!x))];

    const [campaigns, adSets, rules] = await Promise.all([
      campaignIds.length
        ? this.prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } })
        : [],
      adSetIds.length
        ? this.prisma.adSet.findMany({
            where: { id: { in: adSetIds } },
            select: { id: true, name: true, campaign: { select: { id: true, name: true } } },
          })
        : [],
      ruleIds.length
        ? this.prisma.optimizerRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, name: true } })
        : [],
    ]);

    const campaignMap = new Map(campaigns.map((c) => [c.id, c.name]));
    const adSetMap    = new Map(adSets.map((s) => [s.id, s]));
    const ruleMap     = new Map(rules.map((r) => [r.id, r.name]));

    const simulatedAt = new Date().toISOString();

    return approved.map((p, i) => {
      const isAdSet      = p.entityType === 'AD_SET';
      const adSet        = isAdSet ? adSetMap.get(p.entityId) : undefined;
      const campaignId   = isAdSet ? adSet?.campaign.id   : p.entityId;
      const campaignName = isAdSet ? adSet?.campaign.name : campaignMap.get(p.entityId);

      const { before, after } = this.buildSimulateDiff(p);

      return {
        isSimulated: true as const,
        id:           `sim-${p.entityId}-${p.ruleId}-${i}`,
        campaignId:   campaignId   ?? p.entityId,
        campaignName: campaignName ?? '—',
        adSetId:      isAdSet ? p.entityId   : null,
        adSetName:    adSet?.name ?? null,
        entityType:   p.entityType,
        platform:     p.platform,
        actionType:   p.actionType,
        ruleName:     ruleMap.get(p.ruleId) ?? '—',
        before,
        after,
        explanation:  p.explanation,
        projectedImpact: [],
        simulatedAt,
      };
    });
  }

  // Build before/after dicts shaped to match what ValueDiff renders for each action type.
  private buildSimulateDiff(p: import('./dto/proposed-action.dto').ProposedAction):
    { before: Record<string, unknown>; after: Record<string, unknown> } {
    switch (p.actionType) {
      case 'INCREASE_BUDGET':
      case 'DECREASE_BUDGET':
        return {
          before: { daily_budget: p.currentValue  ?? 0, currency: p.adAccountCurrency },
          after:  { daily_budget: p.proposedValue ?? 0, currency: p.adAccountCurrency },
        };
      case 'SWITCH_BIDDING_STRATEGY':
        return {
          before: { bidding_strategy: p.currentValue ?? null },
          after:  { bidding_strategy: p.targetValue  ?? null },
        };
      case 'ADJUST_BID_CEILING':
        return {
          before: { bid_ceiling_sar: p.currentValue  ?? null },
          after:  { bid_ceiling_sar: p.proposedValue ?? null },
        };
      case 'ADJUST_BID_FLOOR':
        return {
          before: { bid_floor_sar: p.currentValue  ?? null },
          after:  { bid_floor_sar: p.proposedValue ?? null },
        };
      default:
        return { before: {}, after: {} };
    }
  }

  @Get('cooldowns')
  @ApiOperation({ summary: 'List active cooldowns for this organization' })
  listCooldowns(@Param('orgId') orgId: string) {
    return this.prisma.cooldownTracker.findMany({
      where: { orgId, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'asc' },
    });
  }
}
