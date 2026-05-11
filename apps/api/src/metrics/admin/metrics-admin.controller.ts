import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MetricsIngestionRunnerService } from '../metrics-ingestion-runner.service';
import { MetricsIngestionObservabilityService } from '../metrics-ingestion-observability.service';
import {
  MetricsIngestionObservabilityDto,
  MetricsIngestionRunRequestDto,
  MetricsIngestionRunResultDto,
} from '../dto/ingestion-run.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/metrics')
export class MetricsAdminController {
  constructor(
    private runner: MetricsIngestionRunnerService,
    private observability: MetricsIngestionObservabilityService,
  ) {}

  @Post('ingest/run')
  @ApiOperation({
    summary: 'Manually trigger a metrics ingestion run.',
    description:
      'Ingests today\'s metric snapshots (24h/48h/72h windows) for every active campaign. ' +
      'When orgId is supplied the run is scoped to that org; otherwise every active org is processed. ' +
      'Idempotent — campaigns whose snapshots already exist for the day are skipped silently inside ' +
      'MetricsIngestionService.',
  })
  @ApiResponse({ status: 200, type: MetricsIngestionRunResultDto })
  async runIngestion(
    @Body() body: MetricsIngestionRunRequestDto,
    @CurrentUser() user: { sub: string },
  ): Promise<MetricsIngestionRunResultDto> {
    const opts = {
      triggeredBy: 'MANUAL' as const,
      userId: user.sub,
      dryRun: !!body.dryRun,
      note: body.note,
    };
    if (body.orgId) {
      return this.runner.ingestForOrg(body.orgId, opts);
    }
    return this.runner.ingestForAllOrgs(opts);
  }

  @Get('ingest/observability')
  @ApiOperation({
    summary: 'Inspect ingestion freshness and recent runs.',
    description:
      'Read-only view: scheduler enabled flag, configured interval, recent run summaries (from audit_logs), ' +
      'and per-ad-account freshness derived from MAX(metric_snapshots.created_at). Pass orgId to scope ' +
      'both run history and freshness to a single org.',
  })
  @ApiResponse({ status: 200, type: MetricsIngestionObservabilityDto })
  getObservability(@Query('orgId') orgId?: string): Promise<MetricsIngestionObservabilityDto> {
    return this.observability.getObservability(orgId);
  }
}
