import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TikTokTokenService } from './tiktok-token.service';

// TikTok access tokens last ~24 hours, so an hourly sweep keeps tokens
// well ahead of expiry without putting unnecessary load on the OAuth
// endpoint. The token service still refreshes opportunistically inside
// provider calls (refreshIfNeeded), but the scheduler keeps tokens fresh
// for accounts that are not actively being polled.

@Injectable()
export class TikTokTokenScheduler {
  private readonly logger = new Logger(TikTokTokenScheduler.name);

  constructor(private tokens: TikTokTokenService) {}

  @Cron('15 * * * *')
  async handlePeriodicRefresh(): Promise<void> {
    const accounts = await this.tokens.findAccountsNeedingRefresh();
    if (accounts.length === 0) return;
    this.logger.log(`TikTok token refresh: ${accounts.length} account(s) due`);
    let rotated = 0;
    for (const a of accounts) {
      try {
        const ok = await this.tokens.forceRefresh(a);
        if (ok) rotated += 1;
      } catch (err) {
        this.logger.error(`Refresh crashed for adAccount=${a.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`TikTok token refresh: rotated=${rotated}/${accounts.length}`);
  }
}
