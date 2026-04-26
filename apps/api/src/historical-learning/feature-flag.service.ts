import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AdminSettingsService } from '../admin/admin-settings.service';

const KEY_ENABLED = 'hll.enabled';
const KEY_CANARY_PCT = 'hll.canary_pct';
const KEY_DECISION_LOGGING = 'hll.decision_logging_enabled';

// Compile-time safety nets — admin can override via settings, but if the
// settings service is empty these are the values that govern behavior.
const DEFAULTS = {
  enabled: false,
  canaryPct: 10,
  decisionLogging: true,
};

@Injectable()
export class HllFeatureFlagService {
  private readonly logger = new Logger(HllFeatureFlagService.name);

  constructor(private settings: AdminSettingsService) {}

  // Master switch — when false, every HLL hook is a no-op.
  async isGloballyEnabled(): Promise<boolean> {
    return this.getSetting<boolean>(KEY_ENABLED, DEFAULTS.enabled);
  }

  // Canary percentage of organizations included in HLL scoring (0-100).
  // Selection is stable per-org via a sha256 hash modulo bucket so a given
  // org either consistently opts in or consistently opts out as the
  // percentage rises.
  async isOrgInCanary(orgId: string): Promise<boolean> {
    const enabled = await this.isGloballyEnabled();
    if (!enabled) return false;

    const pctRaw = await this.getSetting<number>(KEY_CANARY_PCT, DEFAULTS.canaryPct);
    const pct = clamp(Number(pctRaw) || 0, 0, 100);
    if (pct >= 100) return true;
    if (pct <= 0) return false;

    const bucket = orgBucket(orgId);
    return bucket < pct;
  }

  // Decision logging is independent of canary — admins can keep logging on
  // even when scoring is paused for diagnostic comparisons.
  async isDecisionLoggingEnabled(): Promise<boolean> {
    return this.getSetting<boolean>(KEY_DECISION_LOGGING, DEFAULTS.decisionLogging);
  }

  // Reports the org's bucket [0, 100) for debug + audit purposes.
  static orgBucket(orgId: string): number {
    return orgBucket(orgId);
  }

  private async getSetting<T>(key: string, fallback: T): Promise<T> {
    try {
      return (await this.settings.get<T>(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
}

function orgBucket(orgId: string): number {
  const digest = createHash('sha256').update(`hll:${orgId}`).digest();
  // Use the first 4 bytes as an unsigned 32-bit int, mod 100 → [0, 100).
  const n = digest.readUInt32BE(0);
  return n % 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
