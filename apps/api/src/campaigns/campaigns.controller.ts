import {
  Controller, Get, Patch, Body, Param, UseGuards, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MemberRole, OptimizerMode } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CampaignsService } from './campaigns.service';
import { MetricsService } from '../metrics/metrics.service';

@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/campaigns')
export class CampaignsController {
  constructor(
    private campaigns: CampaignsService,
    private metrics: MetricsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  @ApiQuery({ name: 'platform', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'phase', required: false })
  findAll(
    @Param('orgId') orgId: string,
    @Query('platform') platform?: string,
    @Query('status') status?: string,
    @Query('phase') phase?: string,
  ) {
    return this.campaigns.findAll(orgId, { platform, status, phase });
  }

  @Get(':campaignId')
  @ApiOperation({ summary: 'Get campaign details' })
  findOne(@Param('orgId') orgId: string, @Param('campaignId') campaignId: string) {
    return this.campaigns.findOne(campaignId, orgId);
  }

  @Patch(':campaignId/optimizer')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Update campaign optimizer settings (ADMIN+)' })
  updateOptimizer(
    @Param('orgId') orgId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: { optimizerMode?: OptimizerMode; optimizerEnabled?: boolean },
    @CurrentUser() user: { sub: string },
  ) {
    return this.campaigns.updateOptimizerSettings(campaignId, orgId, user.sub, body);
  }

  @Get(':campaignId/metrics')
  @ApiOperation({ summary: 'Get campaign metrics' })
  @ApiQuery({ name: 'window', enum: ['24', '48', '72'], required: false })
  getMetrics(
    @Param('orgId') orgId: string,
    @Param('campaignId') campaignId: string,
    @Query('window') window = '24',
  ) {
    return this.metrics.getForEntity(orgId, 'CAMPAIGN', campaignId, parseInt(window, 10) as 24 | 48 | 72);
  }

  @Get(':campaignId/adsets')
  @ApiOperation({ summary: 'List ad sets in a campaign' })
  getAdSets(@Param('orgId') orgId: string, @Param('campaignId') campaignId: string) {
    return this.campaigns.getAdSets(campaignId, orgId);
  }

  @Get(':campaignId/adsets/:adSetId')
  @ApiOperation({ summary: 'Get ad set details' })
  getAdSet(
    @Param('orgId') orgId: string,
    @Param('campaignId') campaignId: string,
    @Param('adSetId') adSetId: string,
  ) {
    return this.campaigns.getAdSet(adSetId, campaignId, orgId);
  }

  @Patch(':campaignId/adsets/:adSetId/optimizer')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Update ad set optimizer settings (ADMIN+)' })
  updateAdSetOptimizer(
    @Param('adSetId') adSetId: string,
    @Body() body: { optimizerMode?: OptimizerMode; optimizerEnabled?: boolean },
  ) {
    return body; // delegated to a full ad-sets service in a future iteration
  }

  @Get(':campaignId/adsets/:adSetId/metrics')
  @ApiOperation({ summary: 'Get ad set metrics' })
  @ApiQuery({ name: 'window', enum: ['24', '48', '72'], required: false })
  getAdSetMetrics(
    @Param('orgId') orgId: string,
    @Param('adSetId') adSetId: string,
    @Query('window') window = '24',
  ) {
    return this.metrics.getForEntity(orgId, 'AD_SET', adSetId, parseInt(window, 10) as 24 | 48 | 72);
  }
}
