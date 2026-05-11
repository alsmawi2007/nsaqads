import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetaTokenService } from './meta-token.service';

// Daily cron at 03:00 server time. Walks every active Meta ad account and
// refreshes any token nearing expiry. Failures are isolated per-account so
// one bad token cannot block the rest.

@Injectable()
export class MetaTokenScheduler {
  private readonly logger = new Logger(MetaTokenScheduler.name);

  constructor(private tokens: MetaTokenService) {}

  @Cron('0 3 * * *')
  async handleDailyRefresh(): Promise<void> {
    const accounts = await this.tokens.findAccountsNeedingRefresh();
    if (accounts.length === 0) {
      this.logger.log('Meta token refresh: no accounts due');
      return;
    }
    this.logger.log(`Meta token refresh: ${accounts.length} account(s) due`);
    let rotated = 0;
    for (const a of accounts) {
      try {
        const ok = await this.tokens.forceRefresh(a);
        if (ok) rotated += 1;
      } catch (err) {
        this.logger.error(`Refresh crashed for adAccount=${a.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Meta token refresh: rotated=${rotated}/${accounts.length}`);
  }
}
