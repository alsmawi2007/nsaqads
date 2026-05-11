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
import { GoogleAdsOAuthService } from './google-ads-oauth.service';

// Two routes:
//   GET /orgs/:orgId/providers/google-ads/oauth/start  — auth'd; returns the
//                                                       Google authorize URL
//                                                       with a signed state JWT.
//   GET /providers/google-ads/oauth/callback — PUBLIC; the redirect target
//                                              hit by Google. State signature
//                                              is the only auth.

@ApiTags('Providers — Google Ads OAuth')
@Controller()
export class GoogleAdsOAuthController {
  constructor(private oauth: GoogleAdsOAuthService) {}

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
  @ApiOperation({ summary: 'Google Ads OAuth redirect target. State JWT is the only auth.' })
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
