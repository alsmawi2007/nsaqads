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
import { GoogleAdsOAuthService } from './google-ads-oauth.service';
import { oauthSuccessRedirect, oauthErrorRedirect } from '../shared/oauth-redirect';

@ApiTags('Providers — Google Ads OAuth')
@Controller()
export class GoogleAdsOAuthController {
  constructor(private oauth: GoogleAdsOAuthService, private config: ConfigService) {}

  @Get('orgs/:orgId/providers/google-ads/oauth/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
  @Roles(MemberRole.ADMIN)
  @ApiOperation({ summary: 'Build Google Ads OAuth authorize URL (ADMIN+). Returns { url } — frontend redirects.' })
  async start(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { sub: string },
  ): Promise<{ url: string }> {
    return { url: await this.oauth.buildAuthorizeUrl(orgId, user.sub) };
  }

  @Get('providers/google-ads/oauth/callback')
  @ApiOperation({ summary: 'Google Ads OAuth redirect target. State JWT is the only auth. Redirects to /ad-accounts on success/error.' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.oauth.handleCallback(code, state);
      res.redirect(302, oauthSuccessRedirect(this.config, 'GOOGLE_ADS', result.accountsConnected));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'oauth_failed';
      res.redirect(302, oauthErrorRedirect(this.config, 'GOOGLE_ADS', message));
    }
  }
}
