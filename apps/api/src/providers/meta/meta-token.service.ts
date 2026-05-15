import { Injectable, Logger } from '@nestjs/common';
import { AdAccount, AdAccountStatus, Platform } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { encrypt, decrypt } from '../../common/utils/crypto.util';
import { ProviderError, ProviderErrorKind } from '../shared/provider-error';
import { MetaApiClient } from './meta-api.client';
import { META_TOKEN_REFRESH_WINDOW_DAYS } from './meta.constants';

// Token lifecycle:
//   - Long-lived tokens last ~60 days.
//   - We refresh proactively when tokenExpiresAt falls within the configured
//     window (default 7 days).
//   - On hard auth failure (Meta error code 190), we mark the account ERROR
//     so the optimizer skips it and the user is prompted to reconnect.

@Injectable()
export class MetaTokenService {
  private readonly logger = new Logger(MetaTokenService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private api: MetaApiClient,
  ) {}

  // Returns true if the token was rotated; false if no action was needed or
  // the refresh failed (account already marked ERROR).
  async refreshIfNeeded(account: AdAccount): Promise<boolean> {
    if (account.platform !== Platform.META) return false;
    if (account.status === AdAccountStatus.MOCK) return false;

    const cutoff = new Date(Date.now() + META_TOKEN_REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const needsRefresh =
      !account.tokenExpiresAt || account.tokenExpiresAt < cutoff;
    if (!needsRefresh) return false;

    return this.forceRefresh(account);
  }

  async forceRefresh(account: AdAccount): Promise<boolean> {
    const current = decrypt(account.accessToken);
    try {
      const longLived = await this.api.exchangeForLongLivedToken(current);
      if (!longLived.access_token) {
        throw new ProviderError(
          ProviderErrorKind.UNAUTHORIZED,
          'META',
          'Meta returned no access token from refresh',
        );
      }
      const expiresAt = longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000)
        : null;
      await this.prisma.adAccount.update({
        where: { id: account.id },
        data: {
          accessToken:    encrypt(longLived.access_token),
          tokenExpiresAt: expiresAt,
          status:         AdAccountStatus.ACTIVE,
          errorMessage:   null,
        },
      });
      this.logger.log(`Meta token refreshed for adAccount=${account.id}`);
      return true;
    } catch (err) {
      // INVALID_TOKEN means the user revoked or the token is past its hard
      // expiry — only a fresh OAuth flow will fix it.
      const isAuthFail =
        err instanceof ProviderError &&
        (err.kind === ProviderErrorKind.INVALID_TOKEN ||
          err.kind === ProviderErrorKind.UNAUTHORIZED);
      if (isAuthFail) {
        await this.prisma.adAccount.update({
          where: { id: account.id },
          data: {
            status:       AdAccountStatus.ERROR,
            errorMessage: `Token refresh failed: ${err.message}`,
          },
        });
        await this.audit.log({
          orgId:        account.orgId,
          action:       'meta.token.expired',
          resourceType: 'AdAccount',
          resourceId:   account.id,
        });
        this.logger.warn(`Meta token irrecoverable for adAccount=${account.id}; reconnect required`);
      } else {
        // Transient (network, 5xx) — do not flip status, just log.
        this.logger.error(
          `Meta token refresh transient error for adAccount=${account.id}: ${(err as Error).message}`,
        );
      }
      return false;
    }
  }

  // Used by the scheduler — picks all META accounts that need a refresh.
  async findAccountsNeedingRefresh(): Promise<AdAccount[]> {
    const cutoff = new Date(Date.now() + META_TOKEN_REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.adAccount.findMany({
      where: {
        platform:  Platform.META,
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
}
