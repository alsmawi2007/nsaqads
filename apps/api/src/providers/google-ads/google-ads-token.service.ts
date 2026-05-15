import { Injectable, Logger } from '@nestjs/common';
import { AdAccount, AdAccountStatus, Platform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt, decrypt } from '../../common/utils/crypto.util';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { GoogleAdsApiClient } from './google-ads-api.client';
import { GOOGLE_TOKEN_REFRESH_WINDOW_MINUTES } from './google-ads.constants';

// Token lifecycle (Google Ads):
//   - Access tokens last ~1 hour. We refresh proactively when tokenExpiresAt
//     is within GOOGLE_TOKEN_REFRESH_WINDOW_MINUTES.
//   - Refresh tokens are long-lived but can be revoked. On a refresh that
//     fails with `invalid_grant` we mark the account ERROR so the optimizer
//     skips it and the user is prompted to reconnect.
//   - Unlike Meta (which exchanges short→long every ~60d), Google issues a
//     refresh_token only on first consent (with prompt=consent + offline). We
//     never overwrite refresh_token unless the response actually carries one.

@Injectable()
export class GoogleAdsTokenService {
  private readonly logger = new Logger(GoogleAdsTokenService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private api: GoogleAdsApiClient,
  ) {}

  // Returns true if the token was rotated; false if no action was needed or
  // the refresh failed (account already marked ERROR).
  async refreshIfNeeded(account: AdAccount): Promise<boolean> {
    if (account.platform !== Platform.GOOGLE_ADS) return false;
    if (account.status === AdAccountStatus.MOCK) return false;

    const cutoff = new Date(Date.now() + GOOGLE_TOKEN_REFRESH_WINDOW_MINUTES * 60 * 1000);
    const needsRefresh = !account.tokenExpiresAt || account.tokenExpiresAt < cutoff;
    if (!needsRefresh) return false;

    return this.forceRefresh(account);
  }

  async forceRefresh(account: AdAccount): Promise<boolean> {
    if (!account.refreshToken) {
      // No refresh token on file means the OAuth flow was completed without
      // offline access; the user must re-consent. Surface as ERROR.
      await this.markError(account, 'No refresh token on file — reconnect required');
      return false;
    }

    let refreshTokenPlain: string;
    try {
      refreshTokenPlain = decrypt(account.refreshToken);
    } catch (err) {
      await this.markError(account, 'Failed to decrypt refresh token');
      this.logger.error(`Google Ads token decrypt failed adAccount=${account.id}: ${(err as Error).message}`);
      return false;
    }

    try {
      const tokenResponse = await this.api.refreshAccessToken(refreshTokenPlain);
      if (!tokenResponse.access_token) {
        throw new ProviderError(
          ProviderErrorKind.UNAUTHORIZED,
          'GOOGLE_ADS',
          'Google returned no access token from refresh',
        );
      }
      const expiresAt = tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : null;

      // Google sometimes rotates refresh_token (rare, but possible after
      // re-consent). Persist only if a new value is returned.
      const updates: Record<string, unknown> = {
        accessToken:    encrypt(tokenResponse.access_token),
        tokenExpiresAt: expiresAt,
        status:         AdAccountStatus.ACTIVE,
        errorMessage:   null,
      };
      if (tokenResponse.refresh_token) {
        updates.refreshToken = encrypt(tokenResponse.refresh_token);
      }

      await this.prisma.adAccount.update({
        where: { id: account.id },
        data: updates,
      });
      this.logger.log(`Google Ads access token refreshed adAccount=${account.id}`);
      return true;
    } catch (err) {
      const isAuthFail =
        err instanceof ProviderError &&
        (err.kind === ProviderErrorKind.INVALID_TOKEN ||
          err.kind === ProviderErrorKind.UNAUTHORIZED);
      if (isAuthFail) {
        await this.markError(account, `Token refresh failed: ${(err as Error).message}`);
        await this.audit.log({
          orgId:        account.orgId,
          action:       'google-ads.token.expired',
          resourceType: 'AdAccount',
          resourceId:   account.id,
        });
        this.logger.warn(`Google Ads refresh token irrecoverable adAccount=${account.id}; reconnect required`);
      } else {
        // Transient (network, 5xx) — do not flip status, just log.
        this.logger.error(
          `Google Ads token refresh transient error adAccount=${account.id}: ${(err as Error).message}`,
        );
      }
      return false;
    }
  }

  // Used by the scheduler — picks all GOOGLE_ADS accounts that need a refresh.
  async findAccountsNeedingRefresh(): Promise<AdAccount[]> {
    const cutoff = new Date(Date.now() + GOOGLE_TOKEN_REFRESH_WINDOW_MINUTES * 60 * 1000);
    return this.prisma.adAccount.findMany({
      where: {
        platform:  Platform.GOOGLE_ADS,
        deletedAt: null,
        isTracked: true,
        status:    { in: [AdAccountStatus.ACTIVE, AdAccountStatus.PAUSED] },
        OR: [
          { tokenExpiresAt: null },
          { tokenExpiresAt: { lt: cutoff } },
        ],
      },
    });
  }

  private async markError(account: AdAccount, message: string): Promise<void> {
    await this.prisma.adAccount.update({
      where: { id: account.id },
      data: {
        status:       AdAccountStatus.ERROR,
        errorMessage: message,
      },
    });
  }
}
