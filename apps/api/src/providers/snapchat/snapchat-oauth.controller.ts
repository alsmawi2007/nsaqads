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
import { SnapchatOAuthService } from './snapchat-oauth.service';

// Two routes:
//   GET /orgs/:orgId/providers/snapchat/oauth/start  — auth'd; returns the
//        Snap authorize URL with a signed state JWT (orgId+userId).
//   GET /providers/snapchat/oauth/callback           — PUBLIC; the redirect
//        target hit by Snap. State signature is the only auth. On success
//        the user is redirected to the web app's provider settings page
//        with a status query; on failure to the same page with an error.

@ApiTags('Providers — Snapchat OAuth')
@Controller()
export class SnapchatOAuthController {
  constructor(
    private oauth: SnapchatOAuthService,
    private config: ConfigService,
  ) {}

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
  @ApiOperation({ summary: 'Snapchat OAuth redirect target. State JWT is the only auth. Redirects to the web app with a status query.' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const webBase = this.webAppBaseUrl();
    // Redirect to /ad-accounts because that's the natural place to see the
    // result — the org user's connected accounts. System admins testing
    // from /settings/providers still get useful confirmation there because
    // the new account shows up in the list either way.
    try {
      const result = await this.oauth.handleCallback(code, state);
      const url = `${webBase}/ad-accounts?status=connected&platform=snapchat&accounts=${result.accountsConnected}`;
      res.redirect(302, url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'oauth_failed';
      const url = `${webBase}/ad-accounts?status=error&platform=snapchat&message=${encodeURIComponent(message)}`;
      res.redirect(302, url);
    }
  }

  // Resolve the web app base URL for callback redirects.
  //   - PUBLIC_WEB_APP_URL takes precedence (explicit, recommended in prod).
  //   - Otherwise derive from PUBLIC_API_BASE_URL by replacing "api." with
  //     "app." (matches our prod hostname convention).
  //   - Localhost dev fallback: http://localhost:3001.
  private webAppBaseUrl(): string {
    const explicit = this.config.get<string>('PUBLIC_WEB_APP_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const apiBase = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (apiBase) return apiBase.replace(/\/$/, '').replace(/\/\/api\./, '//app.');
    return 'http://localhost:3001';
  }
}
