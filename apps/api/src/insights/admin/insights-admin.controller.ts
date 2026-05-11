import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InsightAnalyticsService } from '../analytics/insight-analytics.service';
import { InsightAdminAnalyticsResponseDto } from '../analytics/insight-analytics.dto';
import { RulePerformanceService } from '../learning/rule-performance.service';
import { RuleHealthResponseDto } from '../learning/rule-performance.dto';
import { RuleTunerSimulationService } from '../learning/rule-tuner-simulation.service';
import { RuleSimulationResponseDto } from '../learning/rule-tuner-simulation.dto';
import { RuleTunerService } from '../learning/rule-tuner.service';
import {
  RuleTunerRollbackResultDto,
  RuleTunerRunRequestDto,
  RuleTunerRunResultDto,
} from '../learning/rule-tuner.dto';
import {
  RuleTunerObservabilityDto,
  RuleTunerRunDetailDto,
  RuleTunerRunListResponseDto,
  RuleTunerSettingsViewDto,
} from '../learning/rule-tuner-history.dto';

interface AuthenticatedUser {
  sub: string;
}

@ApiTags('admin/insights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/insights')
export class InsightsAdminController {
  constructor(
    private analytics: InsightAnalyticsService,
    private rulePerformance: RulePerformanceService,
    private ruleTunerSimulation: RuleTunerSimulationService,
    private ruleTuner: RuleTunerService,
  ) {}

  @Get('analytics')
  @ApiOperation({
    summary: 'Cross-org insight feedback analytics (system-admin only).',
    description:
      'Aggregates the same interaction telemetry surfaced per-org, but spans every org. ' +
      'Useful for identifying rules whose recommendations are widely rejected across customers ' +
      'and for spotting platform-specific feedback patterns.',
  })
  @ApiResponse({ status: 200, type: InsightAdminAnalyticsResponseDto })
  getAnalytics() {
    return this.analytics.getForAdmin();
  }

  @Get('rules/health')
  @ApiOperation({
    summary: 'Per-rule health classification (system-admin only).',
    description:
      'Read-only adaptive intelligence layer. Classifies each rule as HEALTHY / NEEDS_TUNING / UNSTABLE / LOW_SIGNAL ' +
      'based on aggregated user feedback, emits a normalized 0..100 ruleScore, and surfaces advisory hooks for ' +
      'future automated tuning. The hooks are advisory only — no callsite acts on them today.',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    description: 'When provided, classify rules within this org only. Omit for cross-org aggregation.',
  })
  @ApiResponse({ status: 200, type: RuleHealthResponseDto })
  getRuleHealth(@Query('orgId') orgId?: string) {
    if (orgId) return this.rulePerformance.getForOrg(orgId);
    return this.rulePerformance.getForAllOrgs();
  }

  @Get('rules/simulation')
  @ApiOperation({
    summary: 'Shadow auto-tuning simulation (system-admin only).',
    description:
      'Projects what would happen if the advisory hooks from /rules/health were enacted. ' +
      'Replays the lookback window of OptimizerActions against hypothetical tightened thresholds ' +
      'and counts how many firings would be suppressed. The response is tagged isShadowMode=true; ' +
      'no rules, insights, or external systems are modified by this endpoint.',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    description: 'When provided, simulate within this org only. Omit for cross-org simulation.',
  })
  @ApiQuery({
    name: 'lookbackDays',
    required: false,
    description:
      'How many days of OptimizerAction history to replay against the simulated thresholds. ' +
      'Default 30. Larger windows give more confidence but include staler data.',
  })
  @ApiResponse({ status: 200, type: RuleSimulationResponseDto })
  getRuleSimulation(
    @Query('orgId') orgId?: string,
    @Query('lookbackDays') lookbackDays?: string,
  ) {
    const days = lookbackDays ? Math.max(1, Math.min(365, parseInt(lookbackDays, 10) || 30)) : undefined;
    if (orgId) return this.ruleTunerSimulation.getForOrg(orgId, days);
    return this.ruleTunerSimulation.getForAllOrgs(days);
  }

  @Post('rules/auto-tune/run')
  @ApiOperation({
    summary: 'Execute or dry-run controlled auto-tuning (system-admin only).',
    description:
      'Phase I controlled auto-tuner. Reads the live shadow simulation, filters to HIGH-confidence ' +
      'TIGHTEN_THRESHOLD / DISABLE_RULE candidates whose health is NEEDS_TUNING or HEALTHY, ' +
      'and applies survivors atomically. Gated by AdminSetting learning.auto_tune_enabled, an org ' +
      'allowlist, a per-scope cooldown, a per-run change cap, and an actionDeltaRatio safety cap. ' +
      'Set dryRun=true to see what *would* happen without writing.',
  })
  @ApiResponse({ status: 200, type: RuleTunerRunResultDto })
  runAutoTune(
    @Body() body: RuleTunerRunRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RuleTunerRunResultDto> {
    return this.ruleTuner.run({
      orgId: body.orgId,
      dryRun: body.dryRun,
      lookbackDays: body.lookbackDays,
      triggeredByUserId: user.sub,
    });
  }

  @Post('rules/auto-tune/runs/:runId/rollback')
  @ApiOperation({
    summary: 'Roll back every change applied in a prior auto-tune run (system-admin only).',
    description:
      'Idempotent: replays the run\'s RuleTuningLog rows, restoring the original threshold or ' +
      'isEnabled value for every APPLIED entry and marking the log row ROLLED_BACK. Already-rolled-back ' +
      'entries are reported as ALREADY_ROLLED_BACK so the call can be retried safely.',
  })
  @ApiParam({ name: 'runId', description: 'The runId returned by the original auto-tune run.' })
  @ApiResponse({ status: 200, type: RuleTunerRollbackResultDto })
  rollbackAutoTune(
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RuleTunerRollbackResultDto> {
    return this.ruleTuner.rollback(runId, user.sub);
  }

  @Get('rules/auto-tune/runs')
  @ApiOperation({
    summary: 'List recent auto-tune runs (system-admin only).',
    description:
      'Reconstructs run summaries by grouping rule_tuning_logs on run_id. Each summary reports ' +
      'scope, who triggered the run, applied/rolled-back counts, and start/finish timestamps. ' +
      'Use the returned runId with /runs/:runId for the per-change detail.',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    description: 'When provided, restricts the listing to runs scoped to this org. Omit to see every run.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of summaries to return. Default 25, hard cap 200.',
  })
  @ApiResponse({ status: 200, type: RuleTunerRunListResponseDto })
  listAutoTuneRuns(
    @Query('orgId') orgId?: string,
    @Query('limit') limit?: string,
  ): Promise<RuleTunerRunListResponseDto> {
    const lim = limit ? Math.max(1, Math.min(200, parseInt(limit, 10) || 25)) : 25;
    return this.ruleTuner.listRuns(orgId ?? null, lim);
  }

  @Get('rules/auto-tune/runs/:runId')
  @ApiOperation({
    summary: 'Per-run detail with every change row (system-admin only).',
    description:
      'Returns the run summary plus an entry per RuleTuningLog row: before/after value, status ' +
      '(APPLIED or ROLLED_BACK), and the rationale snapshot captured at apply time. 404 when the ' +
      'runId has no log rows.',
  })
  @ApiParam({ name: 'runId', description: 'The runId returned by /auto-tune/run.' })
  @ApiResponse({ status: 200, type: RuleTunerRunDetailDto })
  getAutoTuneRun(@Param('runId') runId: string): Promise<RuleTunerRunDetailDto> {
    return this.ruleTuner.getRun(runId);
  }

  @Get('rules/auto-tune/observability')
  @ApiOperation({
    summary: 'Auto-tune execution dashboard (system-admin only).',
    description:
      'One-call snapshot for the auto-tuner: total runs, applied vs rolled-back log counts, the ' +
      '10 most recent runs, the latest run, the cooldown window, and minutes remaining on the ' +
      'cooldown. Drives an admin "are we safe to run again?" view.',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    description: 'When provided, scopes the dashboard to this org\'s runs. Omit for cross-org admin view.',
  })
  @ApiResponse({ status: 200, type: RuleTunerObservabilityDto })
  getAutoTuneObservability(
    @Query('orgId') orgId?: string,
  ): Promise<RuleTunerObservabilityDto> {
    return this.ruleTuner.getObservability(orgId ?? null);
  }

  @Get('rules/auto-tune/settings')
  @ApiOperation({
    summary: 'Resolved auto-tune safety settings (system-admin only).',
    description:
      'Reads the layered AdminSetting tree (org → global → compile-time default) and reports the ' +
      'final value for each safety control plus the source it resolved from. Useful for confirming ' +
      'a fresh org override took effect, or that the global flag really is what the admin set it to.',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    description: 'When provided, resolves the org-level view. Omit to see the global defaults only.',
  })
  @ApiResponse({ status: 200, type: RuleTunerSettingsViewDto })
  getAutoTuneSettings(@Query('orgId') orgId?: string): Promise<RuleTunerSettingsViewDto> {
    return this.ruleTuner.getResolvedSettingsView(orgId ?? null);
  }
}
