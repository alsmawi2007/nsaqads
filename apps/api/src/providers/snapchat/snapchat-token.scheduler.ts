import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SnapchatTokenService } from './snapchat-token.service';

// Snapchat access tokens last ~30 minutes, so we run a frequent refresh
// sweep every 10 minutes. The token service still refreshes opportunistically
// inside provider calls (refreshIfNeeded), but the scheduler keeps tokens
// fresh for accounts that are not actively being polled.

@Injectable()
export class SnapchatTokenScheduler {
  private readonly logger = new Logger(SnapchatTokenScheduler.name);

  constructor(private tokens: SnapchatTokenService) {}

  @Cron('*/10 * * * *')
  async handlePeriodicRefresh(): Promise<void> {
    const accounts = await this.tokens.findAccountsNeedingRefresh();
    if (accounts.length === 0) return;
    this.logger.log(`Snapchat token refresh: ${accounts.length} account(s) due`);
    let rotated = 0;
    for (const a of accounts) {
      try {
        const ok = await this.tokens.forceRefresh(a);
        if (ok) rotated += 1;
      } catch (err) {
        this.logger.error(`Refresh crashed for adAccount=${a.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Snapchat token refresh: rotated=${rotated}/${accounts.length}`);
  }
}
