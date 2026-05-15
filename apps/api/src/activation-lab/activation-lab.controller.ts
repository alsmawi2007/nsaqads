import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ActivationLabService } from './activation-lab.service';

@ApiTags('Provider Activation Lab')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@Roles(MemberRole.MEMBER)
@Controller('orgs/:orgId/activation-lab')
export class ActivationLabController {
  constructor(private lab: ActivationLabService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Aggregated activation status for the Provider Activation Lab UI.',
    description:
      'One-shot snapshot of providers / tracked accounts / campaigns / ad sets / ' +
      'ingestion freshness / optimizer readiness for this org. The web panel ' +
      'polls this to drive its checklist and status cards. MEMBER+ can read; ' +
      'the actions exposed alongside (sync, ingest, phase override) require ADMIN.',
  })
  getStatus(@Param('orgId') orgId: string) {
    return this.lab.getStatus(orgId);
  }
}
