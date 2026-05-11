import { ApiProperty } from '@nestjs/swagger';
import { Platform } from '@prisma/client';

// ─── Per-pillar DTOs ─────────────────────────────────────────────────────────

export class ReadinessProviderConfigsDto {
  @ApiProperty() configured!: number;
  @ApiProperty() enabled!: number;
  @ApiProperty({ type: [String], enum: ['META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT', 'TWITTER'] })
  enabledPlatforms!: Platform[];
}

export class ReadinessAdAccountsDto {
  @ApiProperty() total!: number;
  @ApiProperty() active!: number;
  @ApiProperty({ description: 'AdAccount.status = ERROR, includes mis-configured tokens.' })
  errored!: number;
  @ApiProperty({ description: 'AdAccount.status = DISCONNECTED — operator must reconnect.' })
  disconnected!: number;
  @ApiProperty({ nullable: true, description: 'Most recent lastSyncedAt across active accounts. Null if no sync has run.' })
  lastSyncedAt!: string | null;
  @ApiProperty({ nullable: true, description: 'Whole minutes since lastSyncedAt. Null when no sync has run.' })
  minutesSinceLastSync!: number | null;
}

export class ReadinessIngestionDto {
  @ApiProperty({ description: 'metrics.ingestion_enabled AdminSetting.' })
  enabled!: boolean;
  @ApiProperty() intervalHours!: number;
  @ApiProperty({ nullable: true, description: 'Most recent metric_snapshots.created_at across all orgs.' })
  lastIngestionAt!: string | null;
  @ApiProperty({ nullable: true, description: 'Whole minutes since lastIngestionAt. Null when nothing ingested yet.' })
  minutesSinceLastIngestion!: number | null;
  @ApiProperty({ description: 'Total metric_snapshots rows present.' })
  snapshotCount!: number;
}

export class ReadinessIntelligenceDto {
  @ApiProperty({ description: 'optimizer_rules table cardinality (global + org-scoped).' })
  ruleCount!: number;
  @ApiProperty({ description: 'optimizer_actions written by any source. Indicates the engine has fired at least once.' })
  optimizerActionCount!: number;
  @ApiProperty({ description: 'rule_tuning_logs cardinality.' })
  ruleTuningLogCount!: number;
}

export class ReadinessGuardrailsDto {
  @ApiProperty({ description: 'learning.auto_tune_enabled AdminSetting. MUST be false during initial rollout.' })
  autoTuneEnabled!: boolean;
  @ApiProperty({ description: 'Active campaigns whose optimizer_mode = AUTO_APPLY. MUST be 0 during initial rollout.' })
  autoApplyCampaignCount!: number;
  @ApiProperty({ description: 'Active campaigns whose optimizer_mode = SUGGEST_ONLY (the safe default).' })
  suggestOnlyCampaignCount!: number;
  @ApiProperty({ description: 'Active campaigns whose optimizer_mode = OFF.' })
  optimizerOffCampaignCount!: number;
  @ApiProperty({
    description: 'true when every release-guardrail invariant holds: auto-tune off AND zero AUTO_APPLY campaigns.',
  })
  rolloutSafetyOk!: boolean;
}

// ─── Top-level response ──────────────────────────────────────────────────────

export class ReadinessResponseDto {
  @ApiProperty({
    enum: ['ready', 'degraded', 'unsafe'],
    description:
      "'ready' = every pillar healthy; 'degraded' = a non-blocking pillar is missing data (e.g. no sync yet); 'unsafe' = guardrails violated, do NOT roll out.",
  })
  status!: 'ready' | 'degraded' | 'unsafe';

  @ApiProperty({ type: [String], description: 'Human-readable reasons for any degraded/unsafe state.' })
  blockers!: string[];

  @ApiProperty({ type: ReadinessProviderConfigsDto })
  providerConfigs!: ReadinessProviderConfigsDto;

  @ApiProperty({ type: ReadinessAdAccountsDto })
  adAccounts!: ReadinessAdAccountsDto;

  @ApiProperty({ type: ReadinessIngestionDto })
  ingestion!: ReadinessIngestionDto;

  @ApiProperty({ type: ReadinessIntelligenceDto })
  intelligence!: ReadinessIntelligenceDto;

  @ApiProperty({ type: ReadinessGuardrailsDto })
  guardrails!: ReadinessGuardrailsDto;

  @ApiProperty() generatedAt!: string;
}
