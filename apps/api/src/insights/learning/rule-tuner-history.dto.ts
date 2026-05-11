import { ApiProperty } from '@nestjs/swagger';
import { RuleTuningStatus } from '@prisma/client';

// ─── Per-run history ─────────────────────────────────────────────────────────

export class RuleTunerRunSummaryDto {
  @ApiProperty()
  runId!: string;

  @ApiProperty({ description: '"ALL" for cross-org runs; otherwise the orgId.' })
  scope!: string;

  @ApiProperty({ description: 'User who triggered the run.' })
  triggeredByUserId!: string;

  @ApiProperty({ description: 'Earliest appliedAt across the run\'s log rows.' })
  startedAt!: string;

  @ApiProperty({ description: 'Latest appliedAt across the run\'s log rows.' })
  finishedAt!: string;

  @ApiProperty({ description: 'Total log rows for this run (every applied or once-applied change).' })
  totalChanges!: number;

  @ApiProperty({ description: 'Rows still in APPLIED status (i.e. not rolled back).' })
  appliedCount!: number;

  @ApiProperty({ description: 'Rows whose status flipped to ROLLED_BACK at some point.' })
  rolledBackCount!: number;

  @ApiProperty({ description: 'True when any row in the run has been rolled back.' })
  hasRollback!: boolean;
}

export class RuleTunerRunEntryDto {
  @ApiProperty()
  logId!: string;

  @ApiProperty()
  ruleId!: string;

  @ApiProperty()
  changeType!: string;

  @ApiProperty()
  fieldName!: string;

  @ApiProperty({ description: 'Pre-change rule value (extracted from the log\'s JSON envelope).' })
  beforeValue!: unknown;

  @ApiProperty({ description: 'Post-change rule value (extracted from the log\'s JSON envelope).' })
  afterValue!: unknown;

  @ApiProperty({ enum: RuleTuningStatus })
  status!: RuleTuningStatus;

  @ApiProperty()
  appliedAt!: string;

  @ApiProperty({ description: 'When the row was rolled back. Null when still APPLIED.', required: false })
  rolledBackAt!: string | null;

  @ApiProperty({ description: 'User who performed the rollback. Null when still APPLIED.', required: false })
  rolledBackById!: string | null;

  @ApiProperty({ description: 'Rationale captured at apply time (confidence, health, deltas, etc.).' })
  rationale!: unknown;
}

export class RuleTunerRunDetailDto {
  @ApiProperty()
  runId!: string;

  @ApiProperty()
  scope!: string;

  @ApiProperty()
  triggeredByUserId!: string;

  @ApiProperty()
  startedAt!: string;

  @ApiProperty()
  finishedAt!: string;

  @ApiProperty()
  totalChanges!: number;

  @ApiProperty()
  appliedCount!: number;

  @ApiProperty()
  rolledBackCount!: number;

  @ApiProperty()
  hasRollback!: boolean;

  @ApiProperty({ type: [RuleTunerRunEntryDto] })
  entries!: RuleTunerRunEntryDto[];
}

// ─── Observability summary ───────────────────────────────────────────────────

export class RuleTunerObservabilityDto {
  @ApiProperty({ description: '"ALL" for cross-org admin view; otherwise the orgId.' })
  scope!: string;

  @ApiProperty({ description: 'Distinct runs in scope. Computed by grouping rule_tuning_logs by run_id.' })
  totalRuns!: number;

  @ApiProperty({ description: 'Log rows still in APPLIED status — every change still in effect.' })
  totalAppliedChanges!: number;

  @ApiProperty({ description: 'Log rows that have been rolled back at least once.' })
  totalRolledBackChanges!: number;

  @ApiProperty({ type: [RuleTunerRunSummaryDto], description: 'Up to 10 most recent runs.' })
  recentRuns!: RuleTunerRunSummaryDto[];

  @ApiProperty({
    type: RuleTunerRunSummaryDto,
    required: false,
    description: 'Latest run that had any applied log rows. Null when no runs exist in scope.',
  })
  lastAppliedRun!: RuleTunerRunSummaryDto | null;

  @ApiProperty({ description: 'Timestamp of the most recent APPLIED log row in scope.', required: false })
  lastAppliedAt!: string | null;

  @ApiProperty({ description: 'True when a fresh run would be blocked by cooldown.' })
  cooldownActive!: boolean;

  @ApiProperty({ description: 'When the cooldown lifts. Null when no prior run is on record.', required: false })
  cooldownExpiresAt!: string | null;

  @ApiProperty({ description: 'Whole minutes remaining on the cooldown. Null when not active.', required: false })
  cooldownRemainingMinutes!: number | null;

  @ApiProperty()
  generatedAt!: string;
}

// ─── Settings exposure ───────────────────────────────────────────────────────

// 'org' = resolved from an org-scoped admin_settings row.
// 'global' = resolved from the global default row (org_id IS NULL).
// 'default' = no admin_settings row found — falling back to the compile-time
//             constant in rule-tuner.service.ts.
export type RuleTunerSettingSource = 'org' | 'global' | 'default';

export class RuleTunerBoolSettingDto {
  @ApiProperty()
  value!: boolean;

  @ApiProperty({ enum: ['org', 'global', 'default'] })
  source!: RuleTunerSettingSource;
}

export class RuleTunerNumberSettingDto {
  @ApiProperty()
  value!: number;

  @ApiProperty({ enum: ['org', 'global', 'default'] })
  source!: RuleTunerSettingSource;
}

export class RuleTunerStringArraySettingDto {
  @ApiProperty({ type: [String] })
  value!: string[];

  @ApiProperty({ enum: ['org', 'global', 'default'] })
  source!: RuleTunerSettingSource;
}

export class RuleTunerSettingsViewDto {
  @ApiProperty({ description: '"ALL" for the global view; otherwise the orgId being inspected.' })
  scope!: string;

  @ApiProperty({ type: RuleTunerBoolSettingDto })
  autoTuneEnabled!: RuleTunerBoolSettingDto;

  @ApiProperty({ type: RuleTunerStringArraySettingDto })
  orgAllowlist!: RuleTunerStringArraySettingDto;

  @ApiProperty({ type: RuleTunerNumberSettingDto })
  maxChangesPerRun!: RuleTunerNumberSettingDto;

  @ApiProperty({ type: RuleTunerNumberSettingDto })
  maxActionDeltaRatio!: RuleTunerNumberSettingDto;

  @ApiProperty({ type: RuleTunerNumberSettingDto })
  cooldownMinutes!: RuleTunerNumberSettingDto;

  @ApiProperty()
  generatedAt!: string;
}

// ─── List response wrapper ──────────────────────────────────────────────────

export class RuleTunerRunListResponseDto {
  @ApiProperty({ description: '"ALL" or the orgId filter applied.' })
  scope!: string;

  @ApiProperty({ description: 'How many summaries were returned. Capped by the limit query param.' })
  count!: number;

  @ApiProperty({ type: [RuleTunerRunSummaryDto] })
  runs!: RuleTunerRunSummaryDto[];

  @ApiProperty()
  generatedAt!: string;
}
