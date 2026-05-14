import {
  Controller, Get, Param, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TikTokOAuthService } from './tiktok-oauth.service';
import { oauthSuccessRedirect, oauthErrorRedirect } from '../shared/oauth-redirect';

// TikTok returns `auth_code` (not `code`) on the callback. Otherwise the
// flow mirrors the other providers: redirect to /ad-accounts after the
// service has handled the token exchange and ad-account upserts.
@ApiTags('Providers — TikTok OAuth')
@Controller()
export class TikTokOAuthController {
  constructor(private oauth: TikTokOAuthService, private config: ConfigService) {}

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
  @ApiOperation({ summary: 'TikTok OAuth redirect target. State JWT is the only auth. Redirects to /ad-accounts on success/error.' })
  @ApiQuery({ name: 'auth_code', required: true })
  @ApiQuery({ name: 'state', required: true })
  async callback(
    @Query('auth_code') authCode: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.oauth.handleCallback(authCode, state);
      res.redirect(302, oauthSuccessRedirect(this.config, 'TIKTOK', result.accountsConnected));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'oauth_failed';
      res.redirect(302, oauthErrorRedirect(this.config, 'TIKTOK', message));
    }
  }
}
