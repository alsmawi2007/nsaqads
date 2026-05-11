import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardIntelligenceService } from './dashboard-intelligence.service';
import { OrgDashboardIntelligenceDto } from './dashboard-intelligence.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/dashboard')
export class DashboardController {
  constructor(
    private dashboard: DashboardService,
    private intelligence: DashboardIntelligenceService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get dashboard summary: KPIs, top campaigns, optimizer today, recent alerts' })
  getSummary(@Param('orgId') orgId: string) {
    return this.dashboard.getSummary(orgId);
  }

  @Get('intelligence')
  @ApiOperation({
    summary: 'Unified read-only operator dashboard for all intelligence layers.',
    description:
      'Aggregates the live insights list, interaction analytics, rule health classification, ' +
      'shadow auto-tuning simulation, and auto-tune execution observability into one response. ' +
      'Designed for a single fetch on dashboard mount: every leaf intelligence service still has ' +
      'its own dedicated endpoint for drill-down. Read-only — no provider calls, no mutations.',
  })
  @ApiResponse({ status: 200, type: OrgDashboardIntelligenceDto })
  getIntelligence(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
  ): Promise<OrgDashboardIntelligenceDto> {
    return this.intelligence.getIntelligenceForOrg(orgId, user.sub);
  }
}
