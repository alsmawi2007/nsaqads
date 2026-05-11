import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// ─── Request DTOs ────────────────────────────────────────────────────────────

export class RuleTunerRunRequestDto {
  @ApiProperty({
    required: false,
    description:
      'When provided, restricts the auto-tune run to rules belonging to this org. Omit for cross-org tuning across global default rules.',
  })
  @IsOptional() @IsString()
  orgId?: string;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'When true, the tuner runs every preflight + filter step but writes nothing — no OptimizerRule mutations, no RuleTuningLog rows. Each candidate is reported with status SKIPPED_DRY_RUN so the caller can see what *would* be applied.',
  })
  @IsOptional() @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 365,
    description:
      'Days of OptimizerAction history forwarded to the underlying simulation. Default 30. Larger windows give higher confidence, smaller windows respond faster to recent feedback shifts.',
  })
  @IsOptional() @IsInt() @Min(1) @Max(365)
  lookbackDays?: number;
}

// ─── Response DTOs ───────────────────────────────────────────────────────────

export enum RuleTunerChangeStatus {
  APPLIED          = 'APPLIED',
  SKIPPED_DRY_RUN  = 'SKIPPED_DRY_RUN',
  BLOCKED          = 'BLOCKED',
  CAPPED           = 'CAPPED',
}

export enum RuleTunerRunStatus {
  EXECUTED              = 'EXECUTED',
  EXECUTED_DRY_RUN      = 'EXECUTED_DRY_RUN',
  BLOCKED_BY_PREFLIGHT  = 'BLOCKED_BY_PREFLIGHT',
  NO_CANDIDATES         = 'NO_CANDIDATES',
}

export class RuleTunerPreflightDto {
  @ApiProperty({ description: 'Resolved value of learning.auto_tune_enabled (org override → global default → false).' })
  autoTuneEnabled!: boolean;

  @ApiProperty({ description: 'Whether the run scope is in learning.auto_tune_org_allowlist (or no allowlist required for cross-org runs).' })
  orgAllowed!: boolean;

  @ApiProperty({ description: 'True when the most recent successful run is still inside the cooldown window.' })
  cooldownActive!: boolean;

  @ApiProperty({ description: 'When the cooldown lifts. Null when no prior run is on record.', required: false })
  cooldownExpiresAt!: string | null;

  @ApiProperty({ description: 'Maximum changes per run, applied as a hard cap to the candidate list.' })
  maxChangesPerRun!: number;

  @ApiProperty({ description: 'Maximum allowed |projectedActionDelta| / currentActionCount for a candidate to qualify.' })
  maxActionDeltaRatio!: number;

  @ApiProperty({
    type: [String],
    description:
      'Reasons the preflight failed (if any). Empty when the run proceeds. The first reason is also surfaced in the top-level run status.',
  })
  blockReasons!: string[];
}

export class RuleTunerChangeRationaleDto {
  @ApiProperty()
  confidence!: string;

  @ApiProperty()
  currentHealth!: string;

  @ApiProperty({ description: 'Action count used as the denominator for the safety ratio.' })
  currentActionCount!: number;

  @ApiProperty({ description: 'Projected change in action firings under the simulated change. Negative for tightening / disable.' })
  projectedActionDelta!: number;

  @ApiProperty({ description: '|projectedActionDelta| / currentActionCount, the safety ratio compared against maxActionDeltaRatio.' })
  actionDeltaRatio!: number;
}

export class RuleTunerChangeDto {
  @ApiProperty()
  ruleId!: string;

  @ApiProperty({ enum: ['TIGHTEN_THRESHOLD', 'DISABLE_RULE', 'RAISE_SCORE_FLOOR', 'NO_CHANGE'] })
  changeType!: string;

  @ApiProperty({ enum: RuleTunerChangeStatus })
  status!: RuleTunerChangeStatus;

  @ApiProperty({
    description: 'Reason this candidate was BLOCKED or CAPPED, or null when it was applied / dry-run.',
  })
  blockReason!: string | null;

  @ApiProperty({ description: 'OptimizerRule field that would change ("thresholdValue" | "isEnabled").' })
  fieldName!: string;

  @ApiProperty({ description: 'Field value before the change.' })
  beforeValue!: unknown;

  @ApiProperty({ description: 'Field value after the change (what will be / would have been written).' })
  afterValue!: unknown;

  @ApiProperty({ type: RuleTunerChangeRationaleDto })
  rationale!: RuleTunerChangeRationaleDto;

  @ApiProperty({
    description: 'RuleTuningLog row id when the change was APPLIED. Null for SKIPPED_DRY_RUN / BLOCKED / CAPPED entries.',
    required: false,
  })
  logId!: string | null;
}

export class RuleTunerRunTotalsDto {
  @ApiProperty({ description: 'Distinct candidates surfaced by the simulation that passed the action-type filter.' })
  candidatesEvaluated!: number;

  @ApiProperty()
  appliedCount!: number;

  @ApiProperty({ description: 'Candidates skipped because of dry-run.' })
  skippedCount!: number;

  @ApiProperty({ description: 'Candidates blocked by per-rule guards (confidence, health, ratio).' })
  blockedCount!: number;

  @ApiProperty({ description: 'Candidates dropped by the maxChangesPerRun cap.' })
  cappedCount!: number;

  @ApiProperty({
    description:
      'Signed sum of projectedActionDelta across changes that applied (or would apply in dry-run). ' +
      'Negative means the run suppresses firings; zero means no net impact. Useful as a one-number ' +
      '"what just changed" signal in observability dashboards.',
  })
  totalProjectedActionDelta!: number;
}

export class RuleTunerRunResultDto {
  @ApiProperty({ description: 'Stable identifier for this run. Use it to roll the run back as a unit.' })
  runId!: string;

  @ApiProperty({ description: '"ALL" when no orgId was provided, otherwise the orgId.' })
  scope!: string;

  @ApiProperty()
  dryRun!: boolean;

  @ApiProperty()
  startedAt!: string;

  @ApiProperty()
  finishedAt!: string;

  @ApiProperty({ enum: RuleTunerRunStatus })
  status!: RuleTunerRunStatus;

  @ApiProperty({ type: RuleTunerPreflightDto })
  preflight!: RuleTunerPreflightDto;

  @ApiProperty({ type: RuleTunerRunTotalsDto })
  totals!: RuleTunerRunTotalsDto;

  @ApiProperty({ type: [RuleTunerChangeDto] })
  changes!: RuleTunerChangeDto[];
}

// ─── Rollback DTOs ──────────────────────────────────────────────────────────

export enum RuleTunerRollbackEntryStatus {
  ROLLED_BACK         = 'ROLLED_BACK',
  ALREADY_ROLLED_BACK = 'ALREADY_ROLLED_BACK',
}

export class RuleTunerRollbackEntryDto {
  @ApiProperty()
  logId!: string;

  @ApiProperty()
  ruleId!: string;

  @ApiProperty()
  fieldName!: string;

  @ApiProperty({ description: 'Value the rule was restored to.' })
  restoredValue!: unknown;

  @ApiProperty({ enum: RuleTunerRollbackEntryStatus })
  status!: RuleTunerRollbackEntryStatus;
}

export class RuleTunerRollbackResultDto {
  @ApiProperty()
  runId!: string;

  @ApiProperty()
  rolledBackCount!: number;

  @ApiProperty({ description: 'Entries that were already rolled back (idempotent re-call).' })
  alreadyRolledBackCount!: number;

  @ApiProperty({ type: [RuleTunerRollbackEntryDto] })
  entries!: RuleTunerRollbackEntryDto[];

  @ApiProperty()
  finishedAt!: string;
}
