import {
  Controller, Get, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AlertsService } from './alerts.service';

@ApiTags('Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/alerts')
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'List alerts for the organization' })
  @ApiQuery({ name: 'severity', required: false, enum: ['INFO', 'WARNING', 'CRITICAL'] })
  @ApiQuery({ name: 'isRead', required: false, type: Boolean })
  @ApiQuery({ name: 'entityId', required: false })
  list(
    @Param('orgId') orgId: string,
    @Query('severity') severity?: string,
    @Query('isRead') isRead?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.alerts.list(orgId, {
      severity,
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
      entityId,
    });
  }

  @Patch(':alertId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a single alert as read' })
  markRead(@Param('alertId') alertId: string) {
    return this.alerts.markRead(alertId);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all alerts as read' })
  markAllRead(@Param('orgId') orgId: string) {
    return this.alerts.markAllRead(orgId);
  }

  @Patch(':alertId/resolve')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Resolve an alert (ADMIN+)' })
  resolve(
    @Param('alertId') alertId: string,
    @Body('note') note: string | undefined,
    @CurrentUser() user: { sub: string },
  ) {
    return this.alerts.resolve(alertId, user.sub, note);
  }
}
