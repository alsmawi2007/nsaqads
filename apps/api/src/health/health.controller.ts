import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../common/guards/system-admin.guard';
import { ReadinessService } from './readiness.service';
import { ReadinessResponseDto } from './readiness.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readiness: ReadinessService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe — returns 200 if the process is up.' })
  @ApiResponse({ status: 200, description: 'Service is up.' })
  check(): { status: 'ok'; timestamp: string; uptime: number } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  // Readiness aggregates the four production-readiness pillars: provider configs,
  // ad-account freshness, ingestion freshness, intelligence availability — plus
  // release guardrails (auto-tune off, no AUTO_APPLY campaigns).
  // Gated behind SYSTEM_ADMIN because the response exposes operator-private state.
  @Get('readiness')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Production-readiness snapshot for rollout gating.',
    description:
      'Aggregates provider-configs, ad-account, ingestion, intelligence, and release-guardrail state. ' +
      'Status is "unsafe" when auto-tune is on or any campaign is on AUTO_APPLY, "degraded" when the ' +
      'pipeline is incomplete (no provider, no sync, no ingestion), and "ready" otherwise.',
  })
  @ApiResponse({ status: 200, type: ReadinessResponseDto })
  getReadiness(): Promise<ReadinessResponseDto> {
    return this.readiness.getReadiness();
  }
}
