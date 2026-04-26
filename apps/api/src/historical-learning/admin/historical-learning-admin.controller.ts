import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FeatureRunTrigger } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { HllFeatureFlagService } from '../feature-flag.service';
import { FeatureComputeService } from '../features/feature-compute.service';
import { OutcomeService } from '../features/outcome.service';
import { HLL_FEATURE_REGISTRY } from '../registry/feature-registry';

@ApiTags('admin/hll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/hll')
export class HistoricalLearningAdminController {
  constructor(
    private prisma: PrismaService,
    private flag: HllFeatureFlagService,
    private compute: FeatureComputeService,
    private outcomes: OutcomeService,
  ) {}

  @Get('registry')
  @ApiOperation({ summary: 'List the HLL feature registry (single source of truth).' })
  registry() {
    return { features: HLL_FEATURE_REGISTRY };
  }

  @Get('orgs/:orgId/canary-status')
  @ApiOperation({ summary: 'Show whether the org is currently included in HLL scoring.' })
  @ApiParam({ name: 'orgId', type: String })
  async canaryStatus(@Param('orgId') orgId: string) {
    const enabled = await this.flag.isGloballyEnabled();
    const inCanary = await this.flag.isOrgInCanary(orgId);
    return {
      orgId,
      globallyEnabled: enabled,
      inCanary,
      bucket: HllFeatureFlagService.orgBucket(orgId),
    };
  }

  @Get('orgs/:orgId/features')
  @ApiOperation({ summary: 'Inspect computed feature rows for an org (debug).' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiQuery({ name: 'feature', required: false, type: String })
  @ApiQuery({ name: 'window', required: false, type: Number })
  async features(
    @Param('orgId') orgId: string,
    @Query('feature') feature?: string,
    @Query('window') window?: string,
  ) {
    const rows = await this.prisma.orgFeature.findMany({
      where: {
        orgId,
        ...(feature ? { featureName: feature } : {}),
        ...(window ? { windowDays: Number(window) } : {}),
      },
      orderBy: { computedAt: 'desc' },
      take: 200,
    });
    return { rows };
  }

  @Get('orgs/:orgId/scoring-decisions')
  @ApiOperation({ summary: 'List recent platform scoring decisions for an org.' })
  @ApiParam({ name: 'orgId', type: String })
  @ApiQuery({ name: 'planId', required: false, type: String })
  async scoringDecisions(@Param('orgId') orgId: string, @Query('planId') planId?: string) {
    const rows = await this.prisma.platformScoringDecision.findMany({
      where: { orgId, ...(planId ? { campaignPlanId: planId } : {}) },
      orderBy: { decidedAt: 'desc' },
      take: 100,
    });
    return { rows };
  }

  @Get('compute-runs')
  @ApiOperation({ summary: 'List recent feature compute runs (global + per-org).' })
  @ApiQuery({ name: 'orgId', required: false, type: String })
  async computeRuns(@Query('orgId') orgId?: string) {
    const rows = await this.prisma.featureComputeRun.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return { rows };
  }

  @Post('orgs/:orgId/compute-now')
  @ApiOperation({ summary: 'Force a feature compute run for an org (manual trigger).' })
  @ApiParam({ name: 'orgId', type: String })
  async computeNow(@Param('orgId') orgId: string) {
    const sealed = await this.outcomes.sealCompletedForOrg(orgId);
    const run = await this.compute.runForOrg(orgId, FeatureRunTrigger.MANUAL);
    return { sealed, run };
  }

  @Post('global-priors/compute-now')
  @ApiOperation({ summary: 'Force a global-priors compute run.' })
  async computeGlobal() {
    const run = await this.compute.runGlobalPriors();
    return { run };
  }

  @Get('health')
  @ApiOperation({ summary: 'HLL pipeline health summary.' })
  async health() {
    const [totalFeatures, staleFeatures, lastSuccess, lastFailure] = await Promise.all([
      this.prisma.orgFeature.count(),
      this.prisma.orgFeature.count({ where: { isStale: true } }),
      this.prisma.featureComputeRun.findFirst({
        where: { status: 'SUCCESS' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, finishedAt: true, featuresWritten: true },
      }),
      this.prisma.featureComputeRun.findFirst({
        where: { status: { in: ['FAILED', 'PARTIAL'] } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, status: true, errorMessage: true },
      }),
    ]);
    return {
      totalFeatures,
      staleFeatures,
      lastSuccess,
      lastFailure,
      flag: {
        enabled: await this.flag.isGloballyEnabled(),
        decisionLogging: await this.flag.isDecisionLoggingEnabled(),
      },
    };
  }
}
