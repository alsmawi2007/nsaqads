import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, RuleTuningChangeType, RuleTuningStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RuleTunerSimulationService } from './rule-tuner-simulation.service';
import {
  RuleSimulationEntryDto,
  RuleSimulationResponseDto,
  SimulatedActionType,
  SimulationConfidence,
} from './rule-tuner-simulation.dto';
import { RuleHealth } from './rule-performance.types';
import {
  RuleTunerChangeDto,
  RuleTunerChangeStatus,
  RuleTunerPreflightDto,
  RuleTunerRollbackEntryDto,
  RuleTunerRollbackEntryStatus,
  RuleTunerRollbackResultDto,
  RuleTunerRunResultDto,
  RuleTunerRunStatus,
} from './rule-tuner.dto';
import {
  RuleTunerObservabilityDto,
  RuleTunerRunDetailDto,
  RuleTunerRunEntryDto,
  RuleTunerRunListResponseDto,
  RuleTunerRunSummaryDto,
  RuleTunerSettingSource,
  RuleTunerSettingsViewDto,
} from './rule-tuner-history.dto';

// Compile-time defaults. AdminSetting overrides each one (org → global → here).
// The numbers are deliberately conservative — production rollout is gated by
// the AdminSetting flag, so default values exist purely so the service has a
// safe behavior in the absence of explicit configuration.
const DEFAULTS = {
  AUTO_TUNE_ENABLED:          false,                // master kill switch
  ORG_ALLOWLIST:              [] as string[],       // empty = no orgs allowed
  MAX_CHANGES_PER_RUN:        10,
  MAX_ACTION_DELTA_RATIO:     0.30,                 // |delta| / current ≤ 30%
  COOLDOWN_MINUTES:           60,
} as const;

const SETTING_KEYS = {
  AUTO_TUNE_ENABLED:          'learning.auto_tune_enabled',
  ORG_ALLOWLIST:              'learning.auto_tune_org_allowlist',
  MAX_CHANGES_PER_RUN:        'learning.auto_tune_max_changes_per_run',
  MAX_ACTION_DELTA_RATIO:     'learning.auto_tune_max_action_delta_ratio',
  COOLDOWN_MINUTES:           'learning.auto_tune_cooldown_minutes',
} as const;

const ALLOWED_HEALTH = new Set<RuleHealth>([RuleHealth.NEEDS_TUNING, RuleHealth.HEALTHY]);

const APPLIED_ACTION_TYPES = new Set<SimulatedActionType>([
  SimulatedActionType.TIGHTEN_THRESHOLD,
  SimulatedActionType.DISABLE_RULE,
]);

interface ResolvedSettings {
  autoTuneEnabled: boolean;
  orgAllowlist: string[];
  maxChangesPerRun: number;
  maxActionDeltaRatio: number;
  cooldownMinutes: number;
}

@Injectable()
export class RuleTunerService {
  private readonly logger = new Logger(RuleTunerService.name);

  constructor(
    private prisma: PrismaService,
    private simulation: RuleTunerSimulationService,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  async run(opts: {
    orgId?: string;
    triggeredByUserId: string;
    dryRun?: boolean;
    lookbackDays?: number;
  }): Promise<RuleTunerRunResultDto> {
    const startedAt = new Date();
    const runId = randomUUID();
    const scope = opts.orgId ?? 'ALL';
    const dryRun = !!opts.dryRun;

    const settings = await this.resolveSettings(opts.orgId ?? null);
    const preflight = await this.runPreflight(opts.orgId ?? null, settings);

    if (preflight.blockReasons.length > 0) {
      return {
        runId,
        scope,
        dryRun,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status: RuleTunerRunStatus.BLOCKED_BY_PREFLIGHT,
        preflight,
        totals: emptyTotals(),
        changes: [],
      };
    }

    // Pull a simulation. The simulation is read-only — it only counts firings
    // against historical evaluation_context and projects deltas.
    const sim: RuleSimulationResponseDto = opts.orgId
      ? await this.simulation.getForOrg(opts.orgId, opts.lookbackDays)
      : await this.simulation.getForAllOrgs(opts.lookbackDays);

    const decisions = decideChanges(sim, settings);

    let appliedCount = 0;
    let skippedCount = 0;
    let blockedCount = 0;
    let cappedCount = 0;

    const finalChanges: RuleTunerChangeDto[] = [];

    for (const d of decisions) {
      if (d.status === RuleTunerChangeStatus.BLOCKED) blockedCount++;
      if (d.status === RuleTunerChangeStatus.CAPPED) cappedCount++;
    }

    // Apply (or simulate-applying) the candidates that survived the filter.
    const toApply = decisions.filter((d) =>
      d.status !== RuleTunerChangeStatus.BLOCKED && d.status !== RuleTunerChangeStatus.CAPPED,
    );

    if (dryRun) {
      // Even in dry-run we read the live before-value so the response shows
      // exactly what the apply path *would* see — drift between simulation
      // state and live state is the most common reason a real run differs.
      for (const d of toApply) {
        const beforeValue = await this.readLiveFieldValue(d.ruleId, d.fieldName);
        finalChanges.push({
          ...d,
          beforeValue,
          status: RuleTunerChangeStatus.SKIPPED_DRY_RUN,
          logId: null,
        });
        skippedCount++;
      }
    } else {
      for (const d of toApply) {
        try {
          const { logId, beforeValue } = await this.applyChange(d, runId, opts.orgId ?? null, opts.triggeredByUserId);
          finalChanges.push({ ...d, beforeValue, status: RuleTunerChangeStatus.APPLIED, logId });
          appliedCount++;
        } catch (err) {
          this.logger.error(`Auto-tune apply failed for rule ${d.ruleId}: ${(err as Error).message}`);
          finalChanges.push({
            ...d,
            status: RuleTunerChangeStatus.BLOCKED,
            blockReason: `Apply failed: ${(err as Error).message}`,
            logId: null,
          });
          blockedCount++;
        }
      }
    }

    // Append the BLOCKED + CAPPED rows last so the UI can see them after the
    // applied set; order within each group preserves the simulation order.
    for (const d of decisions) {
      if (d.status === RuleTunerChangeStatus.BLOCKED || d.status === RuleTunerChangeStatus.CAPPED) {
        finalChanges.push({ ...d, logId: null });
      }
    }

    const candidatesEvaluated = decisions.length;
    const status =
      candidatesEvaluated === 0
        ? RuleTunerRunStatus.NO_CANDIDATES
        : dryRun
        ? RuleTunerRunStatus.EXECUTED_DRY_RUN
        : RuleTunerRunStatus.EXECUTED;

    // Sum the impact across changes that applied (or would apply in dry-run).
    // BLOCKED / CAPPED rows don't contribute — only the deltas that actually
    // shape (or would shape) future firings. Gives admins a one-number
    // "what changed" signal in the run response and the observability view.
    const totalProjectedActionDelta = finalChanges.reduce((sum, c) => {
      if (
        c.status === RuleTunerChangeStatus.APPLIED ||
        c.status === RuleTunerChangeStatus.SKIPPED_DRY_RUN
      ) {
        return sum + (c.rationale?.projectedActionDelta ?? 0);
      }
      return sum;
    }, 0);

    return {
      runId,
      scope,
      dryRun,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status,
      preflight,
      totals: {
        candidatesEvaluated,
        appliedCount,
        skippedCount,
        blockedCount,
        cappedCount,
        totalProjectedActionDelta,
      },
      changes: finalChanges,
    };
  }

  async rollback(runId: string, userId: string): Promise<RuleTunerRollbackResultDto> {
    const logs = await this.prisma.ruleTuningLog.findMany({ where: { runId } });
    if (logs.length === 0) {
      throw new NotFoundException(`No rule tuning logs found for run ${runId}`);
    }

    const entries: RuleTunerRollbackEntryDto[] = [];
    let rolledBackCount = 0;
    let alreadyRolledBackCount = 0;

    for (const log of logs) {
      if (log.status === RuleTuningStatus.ROLLED_BACK) {
        entries.push({
          logId: log.id,
          ruleId: log.ruleId,
          fieldName: log.fieldName,
          restoredValue: extractValue(log.beforeValue),
          status: RuleTunerRollbackEntryStatus.ALREADY_ROLLED_BACK,
        });
        alreadyRolledBackCount++;
        continue;
      }

      const restored = extractValue(log.beforeValue);
      await this.prisma.$transaction([
        this.prisma.optimizerRule.update({
          where: { id: log.ruleId },
          data: ruleUpdateForField(log.fieldName, restored),
        }),
        this.prisma.ruleTuningLog.update({
          where: { id: log.id },
          data: {
            status: RuleTuningStatus.ROLLED_BACK,
            rolledBackAt: new Date(),
            rolledBackById: userId,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            orgId: log.orgId,
            userId,
            action: 'rule.auto_tune.rollback',
            resourceType: 'OptimizerRule',
            resourceId: log.ruleId,
            beforeState: log.afterValue as Prisma.InputJsonValue,
            afterState: log.beforeValue as Prisma.InputJsonValue,
          },
        }),
      ]);

      entries.push({
        logId: log.id,
        ruleId: log.ruleId,
        fieldName: log.fieldName,
        restoredValue: restored,
        status: RuleTunerRollbackEntryStatus.ROLLED_BACK,
      });
      rolledBackCount++;
    }

    return {
      runId,
      rolledBackCount,
      alreadyRolledBackCount,
      entries,
      finishedAt: new Date().toISOString(),
    };
  }

  // ─── Read-only observability surface (Phase J) ────────────────────────────

  // List recent runs in scope. Reconstructs runs from RuleTuningLog rows by
  // grouping on runId — there's no separate runs table, the logs *are* the
  // ledger. The 20× heuristic on the log fetch covers ~20 changes per run on
  // average; if a single run exceeds that, the response simply truncates
  // earlier runs from the tail rather than missing recent ones.
  async listRuns(
    orgId: string | null,
    limit = 25,
  ): Promise<RuleTunerRunListResponseDto> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const logs = await this.prisma.ruleTuningLog.findMany({
      where: orgId === null ? {} : { orgId },
      orderBy: { appliedAt: 'desc' },
      take: cappedLimit * 20,
    });
    const runs = groupLogsIntoRuns(logs).slice(0, cappedLimit);
    return {
      scope: orgId ?? 'ALL',
      count: runs.length,
      runs,
      generatedAt: new Date().toISOString(),
    };
  }

  async getRun(runId: string): Promise<RuleTunerRunDetailDto> {
    const logs = await this.prisma.ruleTuningLog.findMany({
      where: { runId },
      orderBy: { appliedAt: 'asc' },
    });
    if (logs.length === 0) {
      throw new NotFoundException(`No rule tuning logs found for run ${runId}`);
    }
    const summary = summarizeRun(logs);
    return {
      ...summary,
      entries: logs.map(toEntryDto),
    };
  }

  async getObservability(orgId: string | null): Promise<RuleTunerObservabilityDto> {
    const where = orgId === null ? {} : { orgId };

    // Pull a generous slice of the recent log tail so we can group into runs
    // without paginating. 500 rows = enough to cover at least 25 medium runs;
    // beyond that the older history is in /runs anyway.
    const logs = await this.prisma.ruleTuningLog.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
      take: 500,
    });

    const runs = groupLogsIntoRuns(logs);
    const totalAppliedChanges    = logs.filter((l) => l.status === RuleTuningStatus.APPLIED).length;
    const totalRolledBackChanges = logs.filter((l) => l.status === RuleTuningStatus.ROLLED_BACK).length;

    // Cooldown view reuses the same resolution path as the apply path so the
    // dashboard always agrees with what the next /run call will see.
    const settings = await this.resolveSettings(orgId);
    const lastAppliedAt = await this.findLastAppliedAt(orgId);

    let cooldownActive = false;
    let cooldownExpiresAt: string | null = null;
    let cooldownRemainingMinutes: number | null = null;
    if (lastAppliedAt) {
      const expires = new Date(lastAppliedAt.getTime() + settings.cooldownMinutes * 60_000);
      cooldownExpiresAt = expires.toISOString();
      const remainingMs = expires.getTime() - Date.now();
      if (remainingMs > 0) {
        cooldownActive = true;
        cooldownRemainingMinutes = Math.ceil(remainingMs / 60_000);
      }
    }

    return {
      scope: orgId ?? 'ALL',
      totalRuns: runs.length,
      totalAppliedChanges,
      totalRolledBackChanges,
      recentRuns: runs.slice(0, 10),
      lastAppliedRun: runs[0] ?? null,
      lastAppliedAt: lastAppliedAt?.toISOString() ?? null,
      cooldownActive,
      cooldownExpiresAt,
      cooldownRemainingMinutes,
      generatedAt: new Date().toISOString(),
    };
  }

  // Like resolveSettings, but reports *where* each value came from so an admin
  // can tell at a glance whether they're seeing an org override, a global
  // default, or the compile-time fallback. Validates each row before accepting
  // it — a malformed admin_settings.value falls through to the next layer.
  async getResolvedSettingsView(orgId: string | null): Promise<RuleTunerSettingsViewDto> {
    const [enabled, allowlist, maxChanges, maxRatio, cooldown] = await Promise.all([
      this.resolveSettingTyped(orgId, SETTING_KEYS.AUTO_TUNE_ENABLED,      validateBoolean,     DEFAULTS.AUTO_TUNE_ENABLED),
      this.resolveSettingTyped(orgId, SETTING_KEYS.ORG_ALLOWLIST,          validateStringArray, [...DEFAULTS.ORG_ALLOWLIST]),
      this.resolveSettingTyped(orgId, SETTING_KEYS.MAX_CHANGES_PER_RUN,    validatePositiveInt, DEFAULTS.MAX_CHANGES_PER_RUN),
      this.resolveSettingTyped(orgId, SETTING_KEYS.MAX_ACTION_DELTA_RATIO, validateRatio,       DEFAULTS.MAX_ACTION_DELTA_RATIO),
      this.resolveSettingTyped(orgId, SETTING_KEYS.COOLDOWN_MINUTES,       validatePositiveInt, DEFAULTS.COOLDOWN_MINUTES),
    ]);
    return {
      scope: orgId ?? 'ALL',
      autoTuneEnabled:     enabled,
      orgAllowlist:        allowlist,
      maxChangesPerRun:    maxChanges,
      maxActionDeltaRatio: maxRatio,
      cooldownMinutes:     cooldown,
      generatedAt: new Date().toISOString(),
    };
  }

  private async resolveSettingTyped<T>(
    orgId: string | null,
    key: string,
    validate: (raw: unknown) => T | undefined,
    fallback: T,
  ): Promise<{ value: T; source: RuleTunerSettingSource }> {
    if (orgId) {
      const orgRow = await this.prisma.adminSetting.findFirst({ where: { orgId, key } });
      if (orgRow) {
        const valid = validate(orgRow.value);
        if (valid !== undefined) return { value: valid, source: 'org' };
      }
    }
    const globalRow = await this.prisma.adminSetting.findFirst({ where: { orgId: null, key } });
    if (globalRow) {
      const valid = validate(globalRow.value);
      if (valid !== undefined) return { value: valid, source: 'global' };
    }
    return { value: fallback, source: 'default' };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async runPreflight(
    orgId: string | null,
    settings: ResolvedSettings,
  ): Promise<RuleTunerPreflightDto> {
    const blockReasons: string[] = [];
    if (!settings.autoTuneEnabled) blockReasons.push('learning.auto_tune_enabled is false');

    // Cross-org runs do not require allowlist membership; otherwise the org
    // must be present.
    const orgAllowed = orgId === null ? true : settings.orgAllowlist.includes(orgId);
    if (!orgAllowed) blockReasons.push(`org ${orgId} is not in learning.auto_tune_org_allowlist`);

    // Cooldown — based on the latest APPLIED RuleTuningLog row in this scope.
    const lastAppliedAt = await this.findLastAppliedAt(orgId);
    let cooldownActive = false;
    let cooldownExpiresAt: string | null = null;
    if (lastAppliedAt) {
      const expires = new Date(lastAppliedAt.getTime() + settings.cooldownMinutes * 60_000);
      cooldownExpiresAt = expires.toISOString();
      if (expires.getTime() > Date.now()) {
        cooldownActive = true;
        blockReasons.push(`cooldown active until ${cooldownExpiresAt}`);
      }
    }

    return {
      autoTuneEnabled: settings.autoTuneEnabled,
      orgAllowed,
      cooldownActive,
      cooldownExpiresAt,
      maxChangesPerRun: settings.maxChangesPerRun,
      maxActionDeltaRatio: settings.maxActionDeltaRatio,
      blockReasons,
    };
  }

  private async findLastAppliedAt(orgId: string | null): Promise<Date | null> {
    const row = await this.prisma.ruleTuningLog.findFirst({
      where: {
        status: RuleTuningStatus.APPLIED,
        ...(orgId === null ? {} : { orgId }),
      },
      orderBy: { appliedAt: 'desc' },
      select: { appliedAt: true },
    });
    return row?.appliedAt ?? null;
  }

  private async resolveSettings(orgId: string | null): Promise<ResolvedSettings> {
    const [enabled, allowlist, maxChanges, maxRatio, cooldown] = await Promise.all([
      this.readSetting(orgId, SETTING_KEYS.AUTO_TUNE_ENABLED),
      this.readSetting(orgId, SETTING_KEYS.ORG_ALLOWLIST),
      this.readSetting(orgId, SETTING_KEYS.MAX_CHANGES_PER_RUN),
      this.readSetting(orgId, SETTING_KEYS.MAX_ACTION_DELTA_RATIO),
      this.readSetting(orgId, SETTING_KEYS.COOLDOWN_MINUTES),
    ]);
    return {
      autoTuneEnabled:     coerceBoolean(enabled,    DEFAULTS.AUTO_TUNE_ENABLED),
      orgAllowlist:        coerceStringArray(allowlist, DEFAULTS.ORG_ALLOWLIST),
      maxChangesPerRun:    coercePositiveInt(maxChanges, DEFAULTS.MAX_CHANGES_PER_RUN),
      maxActionDeltaRatio: coerceRatio(maxRatio, DEFAULTS.MAX_ACTION_DELTA_RATIO),
      cooldownMinutes:     coercePositiveInt(cooldown,  DEFAULTS.COOLDOWN_MINUTES),
    };
  }

  // org-level override → global default → undefined (caller falls back to compile-time default)
  private async readSetting(orgId: string | null, key: string): Promise<unknown> {
    if (orgId) {
      const orgRow = await this.prisma.adminSetting.findFirst({ where: { orgId, key } });
      if (orgRow) return orgRow.value;
    }
    const globalRow = await this.prisma.adminSetting.findFirst({ where: { orgId: null, key } });
    return globalRow?.value;
  }

  private async applyChange(
    d: RuleTunerChangeDto,
    runId: string,
    orgId: string | null,
    triggeredByUserId: string,
  ): Promise<{ logId: string; beforeValue: unknown }> {
    const logId = randomUUID();
    const afterJson  = { value: d.afterValue  } as Prisma.InputJsonValue;
    const rationaleJson = d.rationale as unknown as Prisma.InputJsonValue;

    const changeType =
      d.changeType === SimulatedActionType.DISABLE_RULE
        ? RuleTuningChangeType.DISABLE_RULE
        : RuleTuningChangeType.TIGHTEN_THRESHOLD;

    // Interactive transaction: read the live before-value, write the rule,
    // and emit the log atomically. Avoids the read/write race where a parallel
    // edit could leave the log claiming a stale before-state.
    return await this.prisma.$transaction(async (tx) => {
      const rule = await tx.optimizerRule.findUnique({ where: { id: d.ruleId } });
      if (!rule) throw new Error(`OptimizerRule ${d.ruleId} not found`);
      const beforeValue = readRuleField(rule, d.fieldName);
      const beforeJson = { value: beforeValue } as Prisma.InputJsonValue;

      await tx.optimizerRule.update({
        where: { id: d.ruleId },
        data: ruleUpdateForField(d.fieldName, d.afterValue),
      });
      await tx.ruleTuningLog.create({
        data: {
          id: logId,
          runId,
          orgId,
          ruleId: d.ruleId,
          changeType,
          fieldName: d.fieldName,
          beforeValue: beforeJson,
          afterValue: afterJson,
          status: RuleTuningStatus.APPLIED,
          triggeredByUserId,
          rationale: rationaleJson,
        },
      });
      await tx.auditLog.create({
        data: {
          orgId,
          userId: triggeredByUserId,
          action: 'rule.auto_tune.apply',
          resourceType: 'OptimizerRule',
          resourceId: d.ruleId,
          beforeState: beforeJson,
          afterState: afterJson,
        },
      });

      return { logId, beforeValue };
    });
  }

  private async readLiveFieldValue(ruleId: string, fieldName: string): Promise<unknown> {
    const rule = await this.prisma.optimizerRule.findUnique({ where: { id: ruleId } });
    if (!rule) return null;
    return readRuleField(rule, fieldName);
  }
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

// Translate a simulation into ordered, status-tagged candidate changes:
// 1. Drop NO_CHANGE / RAISE_SCORE_FLOOR (Phase I doesn't apply ranking changes).
// 2. Block low-confidence, wrong-health, or out-of-bounds candidates with
//    a specific blockReason so the response explains every drop.
// 3. Sort the survivors by impact (largest |delta| first) so the per-run cap
//    keeps the highest-leverage changes.
// 4. Cap to maxChangesPerRun. The dropped tail is tagged CAPPED so admins
//    can see what *would* have applied next.
export function decideChanges(
  sim: RuleSimulationResponseDto,
  settings: ResolvedSettings,
): RuleTunerChangeDto[] {
  const out: RuleTunerChangeDto[] = [];
  const candidates: RuleTunerChangeDto[] = [];

  for (const entry of sim.rules) {
    if (!APPLIED_ACTION_TYPES.has(entry.action.type)) {
      // Out of scope for Phase I — simulated but never applied.
      continue;
    }

    const rationale = {
      confidence:           entry.impact.confidence,
      currentHealth:        entry.currentHealth,
      currentActionCount:   entry.impact.currentActionCount,
      projectedActionDelta: entry.impact.projectedActionDelta,
      actionDeltaRatio:     ratio(entry.impact.projectedActionDelta, entry.impact.currentActionCount),
    };

    const baseChange = baseChangeFor(entry, rationale);
    if (!baseChange) continue;

    const blockReason = checkBlock(entry, rationale, settings);
    if (blockReason) {
      candidates.push({ ...baseChange, status: RuleTunerChangeStatus.BLOCKED, blockReason, logId: null });
    } else {
      candidates.push({ ...baseChange, status: RuleTunerChangeStatus.APPLIED, blockReason: null, logId: null });
    }
  }

  // Sort: APPLIED-eligible first, by largest |projectedActionDelta|; BLOCKED
  // candidates trail (their internal order is preserved).
  candidates.sort((a, b) => {
    if (a.status !== b.status) {
      // APPLIED before BLOCKED so the cap clips the tail of the BLOCKED set.
      return a.status === RuleTunerChangeStatus.APPLIED ? -1 : 1;
    }
    return Math.abs(b.rationale.projectedActionDelta) - Math.abs(a.rationale.projectedActionDelta);
  });

  // Cap eligible (APPLIED) candidates to maxChangesPerRun; tail becomes CAPPED.
  let appliedSlots = settings.maxChangesPerRun;
  for (const c of candidates) {
    if (c.status === RuleTunerChangeStatus.APPLIED) {
      if (appliedSlots <= 0) {
        out.push({ ...c, status: RuleTunerChangeStatus.CAPPED, blockReason: 'maxChangesPerRun cap reached' });
        continue;
      }
      appliedSlots--;
    }
    out.push(c);
  }

  return out;
}

function baseChangeFor(
  entry: RuleSimulationEntryDto,
  rationale: RuleTunerChangeDto['rationale'],
): Omit<RuleTunerChangeDto, 'status' | 'blockReason' | 'logId'> | null {
  if (entry.action.type === SimulatedActionType.TIGHTEN_THRESHOLD) {
    if (entry.action.projectedNewThreshold === null) return null;
    return {
      ruleId: entry.ruleId,
      changeType: SimulatedActionType.TIGHTEN_THRESHOLD,
      fieldName: 'thresholdValue',
      beforeValue: null,                        // filled in at apply time from current rule
      afterValue: entry.action.projectedNewThreshold,
      rationale,
    };
  }
  if (entry.action.type === SimulatedActionType.DISABLE_RULE) {
    return {
      ruleId: entry.ruleId,
      changeType: SimulatedActionType.DISABLE_RULE,
      fieldName: 'isEnabled',
      beforeValue: true,
      afterValue: false,
      rationale,
    };
  }
  return null;
}

function checkBlock(
  entry: RuleSimulationEntryDto,
  rationale: RuleTunerChangeDto['rationale'],
  settings: ResolvedSettings,
): string | null {
  if (entry.impact.confidence !== SimulationConfidence.HIGH) {
    return `confidence ${entry.impact.confidence} is below required HIGH`;
  }
  if (!ALLOWED_HEALTH.has(entry.currentHealth as RuleHealth)) {
    return `health ${entry.currentHealth} is not eligible for auto-tune (need NEEDS_TUNING or HEALTHY)`;
  }
  if (rationale.currentActionCount === 0) {
    return 'no historical actions in lookback window — refusing to act blind';
  }
  if (rationale.actionDeltaRatio > settings.maxActionDeltaRatio) {
    return `actionDeltaRatio ${rationale.actionDeltaRatio.toFixed(3)} exceeds maxActionDeltaRatio ${settings.maxActionDeltaRatio}`;
  }
  return null;
}

function ratio(delta: number, baseline: number): number {
  if (baseline === 0) return 0;
  return Math.abs(delta) / baseline;
}

// Validators return undefined when the raw JSON value isn't acceptable; the
// settings-view path uses that signal to fall through to the next layer
// (org → global → compile-time default) so a malformed override never silently
// short-circuits a valid one underneath.
export function validateBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function validateStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : undefined;
}

export function validatePositiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

export function validateRatio(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

function coerceBoolean(v: unknown, fallback: boolean): boolean {
  return validateBoolean(v) ?? fallback;
}

function coerceStringArray(v: unknown, fallback: string[]): string[] {
  return validateStringArray(v) ?? fallback;
}

function coercePositiveInt(v: unknown, fallback: number): number {
  return validatePositiveInt(v) ?? fallback;
}

function coerceRatio(v: unknown, fallback: number): number {
  return validateRatio(v) ?? fallback;
}

function ruleUpdateForField(fieldName: string, value: unknown): { thresholdValue?: number; isEnabled?: boolean } {
  if (fieldName === 'thresholdValue' && typeof value === 'number') return { thresholdValue: value };
  if (fieldName === 'isEnabled' && typeof value === 'boolean') return { isEnabled: value };
  throw new Error(`Unsupported tuning field ${fieldName} for value ${JSON.stringify(value)}`);
}

// Live read from a rule row by tunable field name. Decimal columns come back
// as Prisma.Decimal instances, so we coerce to number for symmetry with the
// number we write back.
function readRuleField(rule: { thresholdValue: unknown; isEnabled: boolean }, fieldName: string): unknown {
  if (fieldName === 'thresholdValue') return Number(rule.thresholdValue as number);
  if (fieldName === 'isEnabled') return rule.isEnabled;
  throw new Error(`Unsupported tuning field ${fieldName}`);
}

function extractValue(v: unknown): unknown {
  if (v && typeof v === 'object' && 'value' in v) return (v as { value: unknown }).value;
  return v;
}

// ─── Run-history pure helpers (exported for tests) ──────────────────────────

interface RuleTuningLogRow {
  id: string;
  runId: string;
  orgId: string | null;
  ruleId: string;
  changeType: RuleTuningChangeType;
  fieldName: string;
  beforeValue: unknown;
  afterValue: unknown;
  status: RuleTuningStatus;
  triggeredByUserId: string;
  appliedAt: Date;
  rolledBackAt: Date | null;
  rolledBackById: string | null;
  rationale: unknown;
}

// Reconstruct run summaries by grouping rule_tuning_logs on runId. The first
// row in each run carries the canonical scope/triggeredBy values — they're
// guaranteed identical across rows of the same run because the apply path
// writes them once per run.
export function groupLogsIntoRuns(logs: RuleTuningLogRow[]): RuleTunerRunSummaryDto[] {
  const byRun = new Map<string, RuleTuningLogRow[]>();
  for (const log of logs) {
    const arr = byRun.get(log.runId) ?? [];
    arr.push(log);
    byRun.set(log.runId, arr);
  }
  const summaries: RuleTunerRunSummaryDto[] = [];
  for (const runLogs of byRun.values()) {
    summaries.push(summarizeRun(runLogs));
  }
  // ISO 8601 strings are lexicographically comparable; latest run first.
  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return summaries;
}

export function summarizeRun(logs: RuleTuningLogRow[]): RuleTunerRunSummaryDto {
  const sorted = [...logs].sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime());
  const first = sorted[0];
  const last  = sorted[sorted.length - 1];
  const applied    = logs.filter((l) => l.status === RuleTuningStatus.APPLIED).length;
  const rolledBack = logs.filter((l) => l.status === RuleTuningStatus.ROLLED_BACK).length;
  return {
    runId:             first.runId,
    scope:             first.orgId ?? 'ALL',
    triggeredByUserId: first.triggeredByUserId,
    startedAt:         first.appliedAt.toISOString(),
    finishedAt:        last.appliedAt.toISOString(),
    totalChanges:      logs.length,
    appliedCount:      applied,
    rolledBackCount:   rolledBack,
    hasRollback:       rolledBack > 0,
  };
}

function toEntryDto(log: RuleTuningLogRow): RuleTunerRunEntryDto {
  return {
    logId:          log.id,
    ruleId:         log.ruleId,
    changeType:     log.changeType,
    fieldName:      log.fieldName,
    beforeValue:    extractValue(log.beforeValue),
    afterValue:     extractValue(log.afterValue),
    status:         log.status,
    appliedAt:      log.appliedAt.toISOString(),
    rolledBackAt:   log.rolledBackAt ? log.rolledBackAt.toISOString() : null,
    rolledBackById: log.rolledBackById,
    rationale:      log.rationale,
  };
}

function emptyTotals(): RuleTunerRunResultDto['totals'] {
  return {
    candidatesEvaluated: 0,
    appliedCount: 0,
    skippedCount: 0,
    blockedCount: 0,
    cappedCount: 0,
    totalProjectedActionDelta: 0,
  };
}
