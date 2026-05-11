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
import { TikTokOAuthService } from './tiktok-oauth.service';

// Two routes:
//   GET /orgs/:orgId/providers/tiktok/oauth/start  — auth'd; returns the
//        TikTok authorize URL with a signed state JWT (orgId+userId).
//   GET /providers/tiktok/oauth/callback           — PUBLIC; the redirect
//        target hit by TikTok. State signature is the only auth.
//
// TikTok returns an `auth_code` query parameter (not `code`). The frontend /
// browser is the one redirected here, and we forward the auth_code to the
// service for the access_token exchange.

@ApiTags('Providers — TikTok OAuth')
@Controller()
export class TikTokOAuthController {
  constructor(private oauth: TikTokOAuthService) {}

  @Get('orgs/:orgId/providers/tiktok/oauth/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Build TikTok OAuth authorize URL (ADMIN+). Returns { url } — frontend redirects.' })
  async start(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
  ): Promise<{ url: string }> {
    return { url: await this.oauth.buildAuthorizeUrl(orgId, user.sub) };
  }

  @Get('providers/tiktok/oauth/callback')
  @ApiOperation({ summary: 'TikTok OAuth redirect target. State JWT is the only auth.' })
  @ApiQuery({ name: 'auth_code', required: true })
  @ApiQuery({ name: 'state', required: true })
  async callback(
    @Query('auth_code') authCode: string,
    @Query('state') state: string,
  ): Promise<{ orgId: string; accountsConnected: number }> {
    const result = await this.oauth.handleCallback(authCode, state);
    return { orgId: result.orgId, accountsConnected: result.accountsConnected };
  }
}
