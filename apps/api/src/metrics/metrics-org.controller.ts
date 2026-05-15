import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MetricsIngestionRunnerService } from './metrics-ingestion-runner.service';
import { MetricsIngestionObservabilityService } from './metrics-ingestion-observability.service';

class OrgIngestRunDto {
  @IsOptional() @IsBoolean()
  dryRun?: boolean;

  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

// Org-scoped metrics endpoints. The SYSTEM_ADMIN variants under /admin/metrics
// remain authoritative for "ingest every org at once"; this controller is the
// surface a regular org ADMIN uses from the Activation Lab to run ingestion
// on their own org and inspect freshness without dropping to curl.
@ApiTags('Metrics — Org-scoped')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/metrics')
export class MetricsOrgController {
  constructor(
    private runner: MetricsIngestionRunnerService,
    private observability: MetricsIngestionObservabilityService,
  ) {}

  @Post('ingest/run')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({
    summary: 'Manually trigger a metrics ingestion run scoped to this org (ADMIN+).',
    description:
      'Ingests today\'s snapshot for every tracked ad account inside this org. ' +
      'Idempotent — campaigns whose 24h/48h/72h snapshots already exist for the ' +
      'day are skipped silently inside MetricsIngestionService.',
  })
  runIngestion(
    @Param('orgId') orgId: string,
    @Body() body: OrgIngestRunDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.runner.ingestForOrg(orgId, {
      triggeredBy: 'MANUAL',
      userId: user.sub,
      dryRun: !!body.dryRun,
      note: body.note,
    });
  }

  @Get('ingest/observability')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.MEMBER)
  @ApiOperation({
    summary: 'Inspect ingestion freshness for this org (MEMBER+).',
    description:
      'Recent run history (from audit_logs) and per-ad-account freshness ' +
      '(MAX metric_snapshots.created_at) — scoped to this org only.',
  })
  getObservability(
    @Param('orgId') orgId: string,
    @Query('window') _window?: string,
  ) {
    return this.observability.getObservability(orgId);
  }
}
