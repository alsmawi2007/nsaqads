import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsString } from 'class-validator';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdAccountsService } from './ad-accounts.service';
import { ConnectAdAccountDto } from './dto/connect-account.dto';

class SetTrackedDto {
  @IsBoolean()
  isTracked!: boolean;
}

class BulkTrackedDto {
  @IsArray() @IsString({ each: true })
  accountIds!: string[];
  @IsBoolean()
  isTracked!: boolean;
}

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

  @Patch(':accountId/tracked')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Toggle isTracked for a single ad account (ADMIN+). Untracked accounts skip token refresh + metrics ingestion + scheduled sync.' })
  setTracked(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Body() dto: SetTrackedDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.setTracked(orgId, accountId, dto.isTracked, user.sub);
  }

  @Post('bulk-tracked')
  @UseGuards(RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Bulk-set isTracked for an array of ad account ids (ADMIN+). All ids must belong to the org or they are silently ignored.' })
  bulkSetTracked(
    @Param('orgId') orgId: string,
    @Body() dto: BulkTrackedDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.service.bulkSetTracked(orgId, dto.accountIds, dto.isTracked, user.sub);
  }
}
