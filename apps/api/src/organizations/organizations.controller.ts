import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam,
} from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orgs')
export class OrganizationsController {
  constructor(private orgs: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization (caller becomes OWNER)' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  create(
    @Body() dto: CreateOrgDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orgs.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List organizations for the current user' })
  findAll(@CurrentUser() user: { sub: string }) {
    return this.orgs.findAllForUser(user.sub);
  }

  @Get(':orgId')
  @UseGuards(OrgMemberGuard)
  @ApiOperation({ summary: 'Get organization details' })
  @ApiParam({ name: 'orgId', type: String })
  findOne(@Param('orgId') orgId: string) {
    return this.orgs.findOne(orgId);
  }

  @Patch(':orgId')
  @UseGuards(OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.OWNER)
  @ApiOperation({ summary: 'Update organization (OWNER only)' })
  update(
    @Param('orgId') orgId: string,
    @Body() body: { name?: string; logoUrl?: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.orgs.update(orgId, user.sub, body);
  }

  @Get(':orgId/members')
  @UseGuards(OrgMemberGuard)
  @ApiOperation({ summary: 'List organization members' })
  listMembers(@Param('orgId') orgId: string) {
    return this.orgs.listMembers(orgId);
  }

  @Post(':orgId/members/invite')
  @UseGuards(OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Invite a user to the organization (ADMIN+)' })
  invite(
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orgs.inviteMember(orgId, user.sub, dto);
  }

  @Patch(':orgId/members/:userId/role')
  @UseGuards(OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.OWNER)
  @ApiOperation({ summary: 'Change a member role (OWNER only)' })
  updateRole(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orgs.updateMemberRole(orgId, userId, user.sub, dto);
  }

  @Delete(':orgId/members/:userId')
  @UseGuards(OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member (ADMIN+)' })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orgs.removeMember(orgId, userId, user.sub);
  }

  @Delete(':orgId/members/me')
  @UseGuards(OrgMemberGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Leave the organization' })
  leaveOrg(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
  ) {
    return this.orgs.removeMember(orgId, user.sub, user.sub);
  }
}
