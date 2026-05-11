import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InsightInteractionStatus } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InsightsService } from './insights.service';
import { InsightInteractionsService, InsightMetadataInput } from './interactions/insight-interactions.service';
import { InsightAnalyticsService } from './analytics/insight-analytics.service';
import { InsightListResponseDto } from './dto/insight.dto';
import { InsightQueryDto } from './dto/insight-query.dto';
import { InsightFeedbackDto, InsightStatusBodyDto } from './dto/insight-feedback.dto';
import { InsightContextDto } from './dto/insight-context.dto';
import {
  InsightAnalyticsResponseDto,
  InsightRulesAnalyticsResponseDto,
} from './analytics/insight-analytics.dto';

@ApiTags('Insights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId')
export class InsightsController {
  constructor(
    private insights: InsightsService,
    private interactions: InsightInteractionsService,
    private analytics: InsightAnalyticsService,
  ) {}

  @Get('insights')
  @ApiOperation({
    summary: 'List diagnostic insights for the organization (read-only).',
    description:
      'Insights are computed on-demand from the latest metric snapshots and rule definitions. ' +
      'They never write to ad platforms, never auto-apply, and reflect current state at request time. ' +
      'Per-user lifecycle state (SEEN/DISMISSED/SAVED + feedback) is merged into each insight from the ' +
      'insight_interactions table; insights are not persisted, only interactions are.',
  })
  @ApiResponse({ status: 200, type: InsightListResponseDto })
  listForOrg(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
    @Query() query: InsightQueryDto,
  ) {
    return this.insights.listForOrg(orgId, user.sub, query);
  }

  @Get('campaigns/:campaignId/insights')
  @ApiOperation({ summary: 'List insights scoped to a single campaign (and its ad sets).' })
  @ApiResponse({ status: 200, type: InsightListResponseDto })
  listForCampaign(
    @Param('orgId') orgId: string,
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: { sub: string },
    @Query() query: InsightQueryDto,
  ) {
    return this.insights.listForCampaign(orgId, user.sub, campaignId, query);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  @Post('insights/:insightId/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark an insight as seen by the caller.' })
  @ApiResponse({ status: 204, description: 'Status recorded.' })
  async markSeen(
    @Param('orgId') orgId: string,
    @Param('insightId') insightId: string,
    @CurrentUser() user: { sub: string },
    @Body() body?: InsightStatusBodyDto,
  ) {
    await this.interactions.setStatus(
      orgId, insightId, user.sub, InsightInteractionStatus.SEEN, toMetadata(body?.context),
    );
  }

  @Post('insights/:insightId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dismiss an insight for the caller (hides it from the default dashboard view).' })
  @ApiResponse({ status: 204, description: 'Status recorded.' })
  async dismiss(
    @Param('orgId') orgId: string,
    @Param('insightId') insightId: string,
    @CurrentUser() user: { sub: string },
    @Body() body?: InsightStatusBodyDto,
  ) {
    await this.interactions.setStatus(
      orgId, insightId, user.sub, InsightInteractionStatus.DISMISSED, toMetadata(body?.context),
    );
  }

  @Post('insights/:insightId/save')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Save an insight for the caller (pinned for later review).' })
  @ApiResponse({ status: 204, description: 'Status recorded.' })
  async save(
    @Param('orgId') orgId: string,
    @Param('insightId') insightId: string,
    @CurrentUser() user: { sub: string },
    @Body() body?: InsightStatusBodyDto,
  ) {
    await this.interactions.setStatus(
      orgId, insightId, user.sub, InsightInteractionStatus.SAVED, toMetadata(body?.context),
    );
  }

  @Post('insights/:insightId/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Submit feedback (USEFUL / NOT_USEFUL / WRONG / NEEDS_MORE_CONTEXT) on an insight.' })
  @ApiResponse({ status: 204, description: 'Feedback recorded.' })
  async submitFeedback(
    @Param('orgId') orgId: string,
    @Param('insightId') insightId: string,
    @CurrentUser() user: { sub: string },
    @Body() body: InsightFeedbackDto,
  ) {
    await this.interactions.setFeedback(
      orgId, insightId, user.sub, body.feedback, body.note, toMetadata(body.context),
    );
  }

  // ─── Analytics (read-only aggregations over insight_interactions) ──────────

  @Get('insights/analytics')
  @ApiOperation({
    summary: 'Aggregate feedback / status analytics for this org.',
    description:
      'Computed live from insight_interactions. Includes overall counts, rates, and breakdowns by ' +
      'insightType, priority, platform, relatedActionType, and user. Read-only.',
  })
  @ApiResponse({ status: 200, type: InsightAnalyticsResponseDto })
  getAnalytics(@Param('orgId') orgId: string) {
    return this.analytics.getForOrg(orgId);
  }

  @Get('insights/analytics/rules')
  @ApiOperation({
    summary: 'Per-rule feedback analytics — useful/wrong rates per source rule.',
    description:
      'Aggregates only interactions tied to a specific relatedRuleId. Helps surface rules whose ' +
      'recommendations users systematically reject (high WRONG / NOT_USEFUL rate).',
  })
  @ApiResponse({ status: 200, type: InsightRulesAnalyticsResponseDto })
  getRuleAnalytics(@Param('orgId') orgId: string) {
    return this.analytics.getForRules(orgId);
  }
}

function toMetadata(ctx: InsightContextDto | undefined): InsightMetadataInput | undefined {
  if (!ctx) return undefined;
  return {
    insightType:       ctx.insightType,
    severity:          ctx.severity,
    priority:          ctx.priority,
    relatedRuleId:     ctx.relatedRuleId,
    relatedActionType: ctx.relatedActionType,
    platform:          ctx.platform,
    entityType:        ctx.entityType,
    entityId:          ctx.entityId,
  };
}
