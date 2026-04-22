import {
  Controller, Get, Put, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../common/guards/system-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminSettingsService } from './admin-settings.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private settings: AdminSettingsService,
    private prisma: PrismaService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'List all global admin settings' })
  listGlobal() {
    return this.settings.listGlobal();
  }

  @Put('settings/:key')
  @ApiOperation({ summary: 'Upsert a global admin setting' })
  upsertGlobal(
    @Param('key') key: string,
    @Body('value') value: unknown,
    @CurrentUser() user: { sub: string },
  ) {
    return this.settings.upsert(key, value, null, user.sub);
  }

  @Delete('settings/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a global admin setting' })
  deleteGlobal(
    @Param('key') key: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.settings.delete(key, null, user.sub);
  }

  @Get('orgs/:orgId/settings')
  @ApiOperation({ summary: 'List org-level setting overrides' })
  listOrgSettings(@Param('orgId') orgId: string) {
    return this.settings.listForOrg(orgId);
  }

  @Put('orgs/:orgId/settings/:key')
  @ApiOperation({ summary: 'Upsert an org-level setting override' })
  upsertOrgSetting(
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @Body('value') value: unknown,
    @CurrentUser() user: { sub: string },
  ) {
    return this.settings.upsert(key, value, orgId, user.sub);
  }

  @Get('optimizer/rules')
  @ApiOperation({ summary: 'List global optimizer rules' })
  listGlobalRules() {
    return this.prisma.optimizerRule.findMany({ where: { orgId: null } });
  }

  @Put('optimizer/rules/:ruleId')
  @ApiOperation({ summary: 'Update a global optimizer rule' })
  updateGlobalRule(@Param('ruleId') ruleId: string, @Body() body: Record<string, unknown>) {
    return this.prisma.optimizerRule.update({ where: { id: ruleId }, data: body as never });
  }

  @Delete('optimizer/rules/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a global optimizer rule' })
  deleteGlobalRule(@Param('ruleId') ruleId: string) {
    return this.prisma.optimizerRule.delete({ where: { id: ruleId } });
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'System-wide audit log' })
  auditLogs(
    @Param('orgId') orgId?: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('orgs/:orgId/audit-logs')
  @ApiOperation({ summary: 'Org-scoped audit log' })
  orgAuditLogs(@Param('orgId') orgId: string) {
    return this.prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
