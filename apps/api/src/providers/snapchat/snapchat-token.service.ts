import { Injectable, Logger } from '@nestjs/common';
import { AdAccount, AdAccountStatus, Platform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt, decrypt } from '../../common/utils/crypto.util';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { SnapchatApiClient } from './snapchat-api.client';
import { SNAP_TOKEN_REFRESH_WINDOW_SECONDS } from './snapchat.constants';

// Token lifecycle:
//   - Snapchat access tokens last ~30 minutes.
//   - Refresh tokens are long-lived but persist only as long as the user
//     keeps the app authorized; they do NOT auto-rotate on every refresh
//     (Snap may include a new refresh_token in the response — we persist
//     it when present).
//   - We refresh proactively when tokenExpiresAt falls within
//     SNAP_TOKEN_REFRESH_WINDOW_SECONDS of now (default: 5 minutes).
//   - On hard auth failure (401, invalid_grant), we mark the account ERROR
//     so the optimizer skips it and the user is prompted to reconnect.

@Injectable()
export class SnapchatTokenService {
  private readonly logger = new Logger(SnapchatTokenService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private api: SnapchatApiClient,
  ) {}

  // Returns true if the token was rotated; false if no action was needed or
  // the refresh failed (account already marked ERROR).
  async refreshIfNeeded(account: AdAccount): Promise<boolean> {
    if (account.platform !== Platform.SNAPCHAT) return false;
    if (account.status === AdAccountStatus.MOCK) return false;

    const cutoff = new Date(Date.now() + SNAP_TOKEN_REFRESH_WINDOW_SECONDS * 1000);
    const needsRefresh =
      !account.tokenExpiresAt || account.tokenExpiresAt < cutoff;
    if (!needsRefresh) return false;

    return this.forceRefresh(account);
  }

  async forceRefresh(account: AdAccount): Promise<boolean> {
    if (!account.refreshToken) {
      // No refresh token means we cannot recover without a fresh OAuth flow.
      await this.markError(account, 'No refresh token on record; reconnect required');
      return false;
    }
    const currentRefresh = decrypt(account.refreshToken);
    try {
      const res = await this.api.refreshToken(currentRefresh);
      if (!res.access_token) {
        throw new ProviderError(
          ProviderErrorKind.UNAUTHORIZED,
          'SNAPCHAT',
          'Snapchat returned no access token from refresh',
        );
      }
      const expiresAt = res.expires_in
        ? new Date(Date.now() + res.expires_in * 1000)
        : null;

      await this.prisma.adAccount.update({
        where: { id: account.id },
        data: {
          accessToken:    encrypt(res.access_token),
          // Persist a new refresh token only if Snap returned one (rotation
          // is optional — when absent, the existing one stays valid).
          refreshToken:   res.refresh_token ? encrypt(res.refresh_token) : undefined,
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
          errorMessage:   null,
        },
      });
      this.logger.log(`Snapchat token refreshed for adAccount=${account.id}`);
      return true;
    } catch (err) {
      const isAuthFail =
        err instanceof ProviderError &&
        (err.kind === ProviderErrorKind.INVALID_TOKEN ||
          err.kind === ProviderErrorKind.UNAUTHORIZED);
      if (isAuthFail) {
        await this.markError(account, `Token refresh failed: ${(err as Error).message}`);
        this.logger.warn(`Snapchat token irrecoverable for adAccount=${account.id}; reconnect required`);
      } else {
        // Transient — do not flip status, just log.
        this.logger.error(
          `Snapchat token refresh transient error for adAccount=${account.id}: ${(err as Error).message}`,
        );
      }
      return false;
    }
  }

  async findAccountsNeedingRefresh(): Promise<AdAccount[]> {
    const cutoff = new Date(Date.now() + SNAP_TOKEN_REFRESH_WINDOW_SECONDS * 1000);
    return this.prisma.adAccount.findMany({
      where: {
        platform:  Platform.SNAPCHAT,
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
    await this.audit.log({
      orgId:        account.orgId,
      action:       'snapchat.token.expired',
      resourceType: 'AdAccount',
      resourceId:   account.id,
    });
  }
}
