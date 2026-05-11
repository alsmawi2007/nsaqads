import { Injectable } from '@nestjs/common';
import { AdAccount, AdAccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decrypt } from '../../common/utils/crypto.util';
import { ProviderError, ProviderErrorKind } from './provider-error';
import type { AdAccountRef } from '../interfaces/ad-account-ref';

// Loads an AdAccount row by structured AdAccountRef and decrypts the token.
// All real-provider adapters depend on this — keeps decryption in exactly
// one place so the encrypt/decrypt format never drifts.

export interface LoadedAdAccount {
  account:     AdAccount;
  accessToken: string;
}

@Injectable()
export class AdAccountLoader {
  constructor(private prisma: PrismaService) {}

  async load(ref: AdAccountRef): Promise<LoadedAdAccount> {
    const account = await this.prisma.adAccount.findFirst({
      where: { id: ref.id, deletedAt: null },
    });
    if (!account) {
      throw new ProviderError(
        ProviderErrorKind.NOT_FOUND,
        ref.platform,
        `AdAccount ${ref.id} not found or soft-deleted`,
      );
    }
    if (account.platform !== ref.platform) {
      throw new ProviderError(
        ProviderErrorKind.VALIDATION,
        ref.platform,
        `AdAccount ${ref.id} is platform ${account.platform}, not ${ref.platform}`,
      );
    }
    if (account.externalId !== ref.externalId) {
      // The two ids on the ref must agree with the row. Mismatch usually
      // signals a stale ref built from cached data.
      throw new ProviderError(
        ProviderErrorKind.VALIDATION,
        ref.platform,
        `AdAccountRef.externalId=${ref.externalId} does not match DB row externalId=${account.externalId}`,
      );
    }
    if (!account.accessToken) {
      throw new ProviderError(
        ProviderErrorKind.INVALID_TOKEN,
        ref.platform,
        `AdAccount ${ref.id} has no access token; reconnect required`,
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(account.accessToken);
    } catch (err) {
      throw new ProviderError(
        ProviderErrorKind.INVALID_TOKEN,
        ref.platform,
        `Failed to decrypt access token for AdAccount ${ref.id}`,
        { raw: err },
      );
    }

    return { account, accessToken };
  }

  isMock(account: AdAccount): boolean {
    return account.status === AdAccountStatus.MOCK;
  }
}
