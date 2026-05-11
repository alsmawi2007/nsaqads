import {
  Controller, Get, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SnapchatOAuthService } from './snapchat-oauth.service';

// Two routes:
//   GET /orgs/:orgId/providers/snapchat/oauth/start  — auth'd; returns the
//        Snap authorize URL with a signed state JWT (orgId+userId).
//   GET /providers/snapchat/oauth/callback           — PUBLIC; the redirect
//        target hit by Snap. State signature is the only auth.

@ApiTags('Providers — Snapchat OAuth')
@Controller()
export class SnapchatOAuthController {
  constructor(private oauth: SnapchatOAuthService) {}

  @Get('orgs/:orgId/providers/snapchat/oauth/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Build Snapchat OAuth authorize URL (ADMIN+). Returns { url } — frontend redirects.' })
  async start(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
  ): Promise<{ url: string }> {
    return { url: await this.oauth.buildAuthorizeUrl(orgId, user.sub) };
  }

  @Get('providers/snapchat/oauth/callback')
  @ApiOperation({ summary: 'Snapchat OAuth redirect target. State JWT is the only auth.' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
  ): Promise<{ orgId: string; accountsConnected: number }> {
    const result = await this.oauth.handleCallback(code, state);
    return { orgId: result.orgId, accountsConnected: result.accountsConnected };
  }
}
