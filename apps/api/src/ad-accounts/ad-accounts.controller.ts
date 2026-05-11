import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdAccountsService } from './ad-accounts.service';
import { ConnectAdAccountDto } from './dto/connect-account.dto';

@ApiTags('Ad Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('orgs/:orgId/ad-accounts')
export class AdAccountsController {
  constructor(private service: AdAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List connected ad accounts' })
  findAll(@Param('orgId') orgId: string) {
    return this.service.findAll(orgId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(MemberRole.MEMBER)
  @ApiOperation({ summary: 'Connect a new ad account (MEMBER+)' })
  connect(
    @Param('orgId') orgId: string,
    @Body() dto: ConnectAdAccountDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.connect(orgId, user.sub, dto);
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Get ad account details' })
  @ApiParam({ name: 'accountId', type: String })
  findOne(@Param('orgId') orgId: string, @Param('accountId') accountId: string) {
    return this.service.findOne(accountId, orgId);
  }

  @Delete(':accountId')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect an ad account (ADMIN+) — soft delete' })
  disconnect(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.disconnect(accountId, orgId, user.sub);
  }

  @Get(':accountId/health')
  @ApiOperation({ summary: 'Check ad account credentials + token expiry — non-mutating, safe to poll' })
  @ApiParam({ name: 'accountId', type: String })
  health(@Param('orgId') orgId: string, @Param('accountId') accountId: string) {
    return this.service.health(accountId, orgId);
  }

  @Post(':accountId/sync')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.MEMBER)
  @ApiOperation({ summary: 'Sync campaigns from this ad account (MEMBER+)' })
  sync(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.sync(accountId, orgId, user.sub);
  }
}
