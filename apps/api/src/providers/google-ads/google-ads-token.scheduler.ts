import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GoogleAdsTokenService } from './google-ads-token.service';

// Google Ads access tokens last only ~1 hour, but we refresh on-demand inside
// the provider before each call (refreshIfNeeded). The scheduler exists to
// catch accounts that haven't been touched recently — an idle account whose
// token expired won't be refreshed until the next optimizer cycle hits it,
// and a sweep keeps the system responsive when a manual run starts.
//
// Runs hourly at :15 (offset from Meta's 03:00 daily cron).

@Injectable()
export class GoogleAdsTokenScheduler {
  private readonly logger = new Logger(GoogleAdsTokenScheduler.name);

  constructor(private tokens: GoogleAdsTokenService) {}

  @Cron('15 * * * *')
  async handleHourlyRefresh(): Promise<void> {
    const accounts = await this.tokens.findAccountsNeedingRefresh();
    if (accounts.length === 0) {
      this.logger.log('Google Ads token refresh: no accounts due');
      return;
    }
    this.logger.log(`Google Ads token refresh: ${accounts.length} account(s) due`);
    let rotated = 0;
    for (const a of accounts) {
      try {
        const ok = await this.tokens.forceRefresh(a);
        if (ok) rotated += 1;
      } catch (err) {
        this.logger.error(`Refresh crashed for adAccount=${a.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Google Ads token refresh: rotated=${rotated}/${accounts.length}`);
  }
}
