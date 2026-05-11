import { RuleTuningChangeType, RuleTuningStatus } from '@prisma/client';
import {
  RuleTunerService,
  decideChanges,
  groupLogsIntoRuns,
  summarizeRun,
  validateBoolean,
  validatePositiveInt,
  validateRatio,
  validateStringArray,
} from './rule-tuner.service';
import {
  RuleTunerChangeStatus,
  RuleTunerRunStatus,
} from './rule-tuner.dto';
import {
  RuleSimulationActionDto,
  RuleSimulationEntryDto,
  RuleSimulationImpactDto,
  RuleSimulationResponseDto,
  SimulatedActionType,
  SimulationConfidence,
} from './rule-tuner-simulation.dto';
import { RuleHealth } from './rule-performance.types';
import { RuleTunerSimulationService } from './rule-tuner-simulation.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function settings(overrides: Partial<{
  autoTuneEnabled: boolean;
  orgAllowlist: string[];
  maxChangesPerRun: number;
  maxActionDeltaRatio: number;
  cooldownMinutes: number;
}> = {}) {
  return {
    autoTuneEnabled:     true,
    orgAllowlist:        ['org-1'],
    maxChangesPerRun:    10,
    maxActionDeltaRatio: 0.30,
    cooldownMinutes:     60,
    ...overrides,
  };
}

function action(
  overrides: Partial<RuleSimulationActionDto> = {},
): RuleSimulationActionDto {
  return {
    type:                   SimulatedActionType.TIGHTEN_THRESHOLD,
    description:            'tighten threshold by 10%',
    proposedThresholdDelta: -0.1,
    projectedNewThreshold:  55,
    proposedScoreFloor:     null,
    shouldDisable:          false,
    ...overrides,
  };
}

function impact(
  overrides: Partial<RuleSimulationImpactDto> = {},
): RuleSimulationImpactDto {
  return {
    currentInteractionCount:  60,
    currentActionCount:       40,
    projectedActionCount:     35,
    projectedActionDelta:     -5,
    suppressedActionCount:    5,
    indeterminateActionCount: 0,
    confidence:               SimulationConfidence.HIGH,
    notes:                    [],
    ...overrides,
  };
}

function ruleEntry(
  overrides: Partial<RuleSimulationEntryDto> = {},
): RuleSimulationEntryDto {
  return {
    ruleId:           'rule-A',
    scope:            'org-1',
    currentHealth:    RuleHealth.NEEDS_TUNING,
    currentRuleScore: 45,
    action:           action(),
    impact:           impact(),
    ...overrides,
  };
}

function simulationResponse(
  rules: RuleSimulationEntryDto[],
  overrides: Partial<RuleSimulationResponseDto> = {},
): RuleSimulationResponseDto {
  return {
    scope:              'org-1',
    lookbackDays:       30,
    summary: {
      totalRules:               rules.length,
      rulesByAction: {
        [SimulatedActionType.NO_CHANGE]:         0,
        [SimulatedActionType.TIGHTEN_THRESHOLD]: 0,
        [SimulatedActionType.DISABLE_RULE]:      0,
        [SimulatedActionType.RAISE_SCORE_FLOOR]: 0,
      },
      totalCurrentInteractions:  0,
      totalCurrentActions:       0,
      totalProjectedActionDelta: 0,
      highConfidenceRuleCount:   0,
    },
    rules,
    isShadowMode:       true,
    uncategorizedCount: 0,
    generatedAt:        new Date().toISOString(),
    ...overrides,
  };
}

// ─── decideChanges (pure helper) ─────────────────────────────────────────────

describe('decideChanges', () => {
  it('drops NO_CHANGE and RAISE_SCORE_FLOOR — they are out of scope for Phase I', () => {
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-noop',  action: action({ type: SimulatedActionType.NO_CHANGE }) }),
      ruleEntry({ ruleId: 'r-floor', action: action({ type: SimulatedActionType.RAISE_SCORE_FLOOR }) }),
    ]);
    expect(decideChanges(sim, settings())).toEqual([]);
  });

  it('blocks LOW / MEDIUM confidence with a specific reason', () => {
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-low',  impact: impact({ confidence: SimulationConfidence.LOW }) }),
      ruleEntry({ ruleId: 'r-med',  impact: impact({ confidence: SimulationConfidence.MEDIUM }) }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.status).toBe(RuleTunerChangeStatus.BLOCKED);
      expect(c.blockReason).toMatch(/confidence/);
    }
  });

  it('blocks UNSTABLE / LOW_SIGNAL health rules', () => {
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-unstable', currentHealth: RuleHealth.UNSTABLE }),
      ruleEntry({ ruleId: 'r-lowsig',   currentHealth: RuleHealth.LOW_SIGNAL }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.status).toBe(RuleTunerChangeStatus.BLOCKED);
      expect(c.blockReason).toMatch(/health/);
    }
  });

  it('allows NEEDS_TUNING and HEALTHY with HIGH confidence', () => {
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-needs',  currentHealth: RuleHealth.NEEDS_TUNING }),
      ruleEntry({ ruleId: 'r-healthy', currentHealth: RuleHealth.HEALTHY }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.status).toBe(RuleTunerChangeStatus.APPLIED);
      expect(c.blockReason).toBeNull();
    }
  });

  it('blocks zero currentActionCount — refuses to act blind', () => {
    const sim = simulationResponse([
      ruleEntry({ impact: impact({ currentActionCount: 0, projectedActionDelta: 0 }) }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out[0].status).toBe(RuleTunerChangeStatus.BLOCKED);
    expect(out[0].blockReason).toMatch(/no historical actions/);
  });

  it('blocks when actionDeltaRatio exceeds maxActionDeltaRatio', () => {
    // 20 / 50 = 0.40, above the default 0.30 cap
    const sim = simulationResponse([
      ruleEntry({ impact: impact({ currentActionCount: 50, projectedActionDelta: -20 }) }),
    ]);
    const out = decideChanges(sim, settings({ maxActionDeltaRatio: 0.30 }));
    expect(out[0].status).toBe(RuleTunerChangeStatus.BLOCKED);
    expect(out[0].blockReason).toMatch(/actionDeltaRatio/);
  });

  it('allows when actionDeltaRatio is right at the cap', () => {
    // 15 / 50 = 0.30 — equal, not above
    const sim = simulationResponse([
      ruleEntry({ impact: impact({ currentActionCount: 50, projectedActionDelta: -15 }) }),
    ]);
    const out = decideChanges(sim, settings({ maxActionDeltaRatio: 0.30 }));
    expect(out[0].status).toBe(RuleTunerChangeStatus.APPLIED);
  });

  it('caps eligible candidates at maxChangesPerRun, tagging the tail as CAPPED', () => {
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r1', impact: impact({ projectedActionDelta: -10 }) }),
      ruleEntry({ ruleId: 'r2', impact: impact({ projectedActionDelta: -8 }) }),
      ruleEntry({ ruleId: 'r3', impact: impact({ projectedActionDelta: -6 }) }),
    ]);
    const out = decideChanges(sim, settings({ maxChangesPerRun: 2 }));
    expect(out).toHaveLength(3);
    expect(out[0].status).toBe(RuleTunerChangeStatus.APPLIED);
    expect(out[1].status).toBe(RuleTunerChangeStatus.APPLIED);
    expect(out[2].status).toBe(RuleTunerChangeStatus.CAPPED);
    expect(out[2].blockReason).toMatch(/maxChangesPerRun/);
  });

  it('sorts APPLIED-eligible candidates by largest |projectedActionDelta| first', () => {
    // currentActionCount 200 keeps every ratio under the 0.30 cap so all three
    // pass the gate and the sort ordering is what's actually being asserted.
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-small', impact: impact({ currentActionCount: 200, projectedActionDelta: -2 }) }),
      ruleEntry({ ruleId: 'r-big',   impact: impact({ currentActionCount: 200, projectedActionDelta: -20 }) }),
      ruleEntry({ ruleId: 'r-mid',   impact: impact({ currentActionCount: 200, projectedActionDelta: -10 }) }),
    ]);
    const out = decideChanges(sim, settings({ maxChangesPerRun: 10 }));
    const ids = out.map((c) => c.ruleId);
    expect(ids).toEqual(['r-big', 'r-mid', 'r-small']);
  });

  it('shapes TIGHTEN_THRESHOLD as fieldName=thresholdValue with afterValue=projectedNewThreshold', () => {
    const sim = simulationResponse([
      ruleEntry({
        action: action({
          type: SimulatedActionType.TIGHTEN_THRESHOLD,
          projectedNewThreshold: 55,
        }),
      }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out[0].fieldName).toBe('thresholdValue');
    expect(out[0].afterValue).toBe(55);
    expect(out[0].changeType).toBe(SimulatedActionType.TIGHTEN_THRESHOLD);
  });

  it('shapes DISABLE_RULE as fieldName=isEnabled with afterValue=false', () => {
    const sim = simulationResponse([
      ruleEntry({
        action: action({ type: SimulatedActionType.DISABLE_RULE, projectedNewThreshold: null }),
      }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out[0].fieldName).toBe('isEnabled');
    expect(out[0].afterValue).toBe(false);
    expect(out[0].beforeValue).toBe(true);
    expect(out[0].changeType).toBe(SimulatedActionType.DISABLE_RULE);
  });

  it('drops a TIGHTEN candidate that has no projectedNewThreshold (rule def missing in simulation)', () => {
    const sim = simulationResponse([
      ruleEntry({
        action: action({
          type: SimulatedActionType.TIGHTEN_THRESHOLD,
          projectedNewThreshold: null,
        }),
      }),
    ]);
    const out = decideChanges(sim, settings());
    expect(out).toHaveLength(0);
  });
});

// ─── Service ─────────────────────────────────────────────────────────────────

interface MockPrisma {
  ruleTuningLog: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock; create: jest.Mock };
  adminSetting:  { findFirst: jest.Mock };
  optimizerRule: { findUnique: jest.Mock; update: jest.Mock };
  auditLog:      { create: jest.Mock };
  $transaction:  jest.Mock;
}

function buildPrisma(initial?: {
  settings?: Record<string, unknown>;
  lastApplied?: Date | null;
  rules?: Record<string, { thresholdValue: number; isEnabled: boolean }>;
}): MockPrisma {
  const ruleStore: Record<string, { thresholdValue: number; isEnabled: boolean }> = {
    ...(initial?.rules ?? {}),
  };

  const adminSetting = {
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      // Service calls org-level first then global. Return the same value
      // either way unless tests explicitly distinguish.
      const map = initial?.settings ?? {};
      const value = map[where.key];
      if (where.orgId !== null && where.orgId !== undefined) return null; // force fallback to global
      if (value === undefined) return null;
      return { value };
    }),
  };

  const ruleTuningLog = {
    findFirst: jest.fn().mockResolvedValue(
      initial?.lastApplied ? { appliedAt: initial.lastApplied } : null,
    ),
    findMany: jest.fn().mockResolvedValue([]),
    update:   jest.fn().mockResolvedValue({}),
    create:   jest.fn().mockResolvedValue({}),
  };

  const optimizerRule = {
    findUnique: jest.fn().mockImplementation(({ where }: any) => {
      const r = ruleStore[where.id];
      if (!r) return null;
      return { id: where.id, ...r };
    }),
    update: jest.fn().mockImplementation(({ where, data }: any) => {
      if (ruleStore[where.id]) {
        ruleStore[where.id] = { ...ruleStore[where.id], ...data };
      }
      return { id: where.id, ...ruleStore[where.id] };
    }),
  };

  const auditLog = { create: jest.fn().mockResolvedValue({}) };

  const prisma: MockPrisma = {
    ruleTuningLog,
    adminSetting,
    optimizerRule,
    auditLog,
    // Support both array and callback form. The service uses callback form for
    // applyChange and array form for rollback.
    $transaction: jest.fn().mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({ ruleTuningLog, optimizerRule, auditLog });
      }
      return Promise.all(arg);
    }),
  };
  return prisma;
}

function buildService(prisma: MockPrisma, sim: RuleSimulationResponseDto) {
  const simulation: Partial<RuleTunerSimulationService> = {
    getForOrg:     jest.fn().mockResolvedValue(sim),
    getForAllOrgs: jest.fn().mockResolvedValue(sim),
  };
  return new RuleTunerService(
    prisma as unknown as PrismaService,
    simulation as RuleTunerSimulationService,
  );
}

// ─── Preflight ───────────────────────────────────────────────────────────────

describe('RuleTunerService preflight', () => {
  it('blocks when learning.auto_tune_enabled is false (or unset)', async () => {
    // No settings configured at all → fall back to compile-time DEFAULT (false).
    const prisma = buildPrisma();
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });

    expect(result.status).toBe(RuleTunerRunStatus.BLOCKED_BY_PREFLIGHT);
    expect(result.preflight.autoTuneEnabled).toBe(false);
    expect(result.preflight.blockReasons[0]).toMatch(/auto_tune_enabled/);
    expect(result.changes).toEqual([]);
    // Simulation is never invoked — preflight short-circuits.
  });

  it('blocks when org is not in learning.auto_tune_org_allowlist', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-other'],
      },
    });
    const service = buildService(prisma, simulationResponse([]));
    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });

    expect(result.status).toBe(RuleTunerRunStatus.BLOCKED_BY_PREFLIGHT);
    expect(result.preflight.orgAllowed).toBe(false);
    expect(result.preflight.blockReasons.some((r) => r.includes('allowlist'))).toBe(true);
  });

  it('cross-org runs do not require allowlist membership', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': [],
      },
    });
    const service = buildService(prisma, simulationResponse([]));
    const result = await service.run({ triggeredByUserId: 'u1' }); // no orgId

    expect(result.status).not.toBe(RuleTunerRunStatus.BLOCKED_BY_PREFLIGHT);
    expect(result.preflight.orgAllowed).toBe(true);
  });

  it('blocks when cooldown is still active', async () => {
    // Most recent APPLIED was 5 minutes ago; cooldown is 60 min → still active.
    const lastApplied = new Date(Date.now() - 5 * 60_000);
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
        'learning.auto_tune_cooldown_minutes': 60,
      },
      lastApplied,
    });
    const service = buildService(prisma, simulationResponse([]));
    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });

    expect(result.status).toBe(RuleTunerRunStatus.BLOCKED_BY_PREFLIGHT);
    expect(result.preflight.cooldownActive).toBe(true);
    expect(result.preflight.cooldownExpiresAt).not.toBeNull();
    expect(result.preflight.blockReasons.some((r) => r.includes('cooldown'))).toBe(true);
  });

  it('does not block when the cooldown has elapsed', async () => {
    // 2 hours ago; cooldown is 60 min → cleared.
    const lastApplied = new Date(Date.now() - 120 * 60_000);
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
        'learning.auto_tune_cooldown_minutes': 60,
      },
      lastApplied,
    });
    const service = buildService(prisma, simulationResponse([]));
    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });

    expect(result.preflight.cooldownActive).toBe(false);
    expect(result.preflight.cooldownExpiresAt).not.toBeNull();
    expect(result.status).not.toBe(RuleTunerRunStatus.BLOCKED_BY_PREFLIGHT);
  });
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

describe('RuleTunerService dry run', () => {
  it('writes nothing — every eligible candidate is tagged SKIPPED_DRY_RUN', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
      rules: {
        'rule-A': { thresholdValue: 50, isEnabled: true },
      },
    });
    const sim = simulationResponse([ruleEntry({ ruleId: 'rule-A' })]);
    const service = buildService(prisma, sim);

    const result = await service.run({
      orgId: 'org-1',
      triggeredByUserId: 'u1',
      dryRun: true,
    });

    expect(result.status).toBe(RuleTunerRunStatus.EXECUTED_DRY_RUN);
    expect(result.dryRun).toBe(true);
    expect(result.totals.appliedCount).toBe(0);
    expect(result.totals.skippedCount).toBe(1);
    expect(result.changes[0].status).toBe(RuleTunerChangeStatus.SKIPPED_DRY_RUN);
    // Dry run reads the *live* rule so the response shows real before-value.
    expect(result.changes[0].beforeValue).toBe(50);
    expect(result.changes[0].afterValue).toBe(55);
    expect(result.changes[0].logId).toBeNull();

    // No mutations went out.
    expect(prisma.ruleTuningLog.create).not.toHaveBeenCalled();
    expect(prisma.optimizerRule.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

// ─── Apply path ──────────────────────────────────────────────────────────────

describe('RuleTunerService apply path', () => {
  it('writes RuleTuningLog + updates OptimizerRule + writes AuditLog atomically', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
      rules: {
        'rule-A': { thresholdValue: 50, isEnabled: true },
      },
    });
    const sim = simulationResponse([ruleEntry({ ruleId: 'rule-A' })]);
    const service = buildService(prisma, sim);

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });

    expect(result.status).toBe(RuleTunerRunStatus.EXECUTED);
    expect(result.totals.appliedCount).toBe(1);
    expect(result.changes[0].status).toBe(RuleTunerChangeStatus.APPLIED);
    expect(result.changes[0].beforeValue).toBe(50);
    expect(result.changes[0].afterValue).toBe(55);
    expect(result.changes[0].logId).not.toBeNull();

    // Triple-write inside the interactive transaction.
    expect(prisma.optimizerRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-A' },
      data: { thresholdValue: 55 },
    });
    expect(prisma.ruleTuningLog.create).toHaveBeenCalledTimes(1);
    const logCall = prisma.ruleTuningLog.create.mock.calls[0][0];
    expect(logCall.data.runId).toBe(result.runId);
    expect(logCall.data.ruleId).toBe('rule-A');
    expect(logCall.data.fieldName).toBe('thresholdValue');
    expect(logCall.data.beforeValue).toEqual({ value: 50 });
    expect(logCall.data.afterValue).toEqual({ value: 55 });
    expect(logCall.data.status).toBe(RuleTuningStatus.APPLIED);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('rule.auto_tune.apply');
  });

  it('disables a rule by writing isEnabled=false', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
      rules: {
        'rule-A': { thresholdValue: 50, isEnabled: true },
      },
    });
    const sim = simulationResponse([
      ruleEntry({
        ruleId: 'rule-A',
        action: action({ type: SimulatedActionType.DISABLE_RULE, projectedNewThreshold: null }),
      }),
    ]);
    const service = buildService(prisma, sim);

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });

    expect(result.changes[0].status).toBe(RuleTunerChangeStatus.APPLIED);
    expect(prisma.optimizerRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-A' },
      data: { isEnabled: false },
    });
  });

  it('returns NO_CANDIDATES when the simulation produces nothing actionable', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
    });
    const sim = simulationResponse([
      ruleEntry({ action: action({ type: SimulatedActionType.NO_CHANGE }) }),
    ]);
    const service = buildService(prisma, sim);

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });
    expect(result.status).toBe(RuleTunerRunStatus.NO_CANDIDATES);
    expect(result.totals.candidatesEvaluated).toBe(0);
  });
});

// ─── Rollback ────────────────────────────────────────────────────────────────

describe('RuleTunerService rollback', () => {
  it('restores beforeValue, marks the log ROLLED_BACK, writes AuditLog', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        runId: 'run-X',
        orgId: 'org-1',
        ruleId: 'rule-A',
        fieldName: 'thresholdValue',
        beforeValue: { value: 50 },
        afterValue:  { value: 55 },
        status: RuleTuningStatus.APPLIED,
      },
    ]);

    const service = buildService(prisma, simulationResponse([]));
    const result = await service.rollback('run-X', 'admin-1');

    expect(result.runId).toBe('run-X');
    expect(result.rolledBackCount).toBe(1);
    expect(result.alreadyRolledBackCount).toBe(0);
    expect(result.entries[0].restoredValue).toBe(50);

    // Three-write transaction: rule update → log update → audit log
    expect(prisma.optimizerRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-A' },
      data:  { thresholdValue: 50 },
    });
    expect(prisma.ruleTuningLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: RuleTuningStatus.ROLLED_BACK, rolledBackById: 'admin-1' }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'rule.auto_tune.rollback' }),
      }),
    );
  });

  it('idempotent — rows already ROLLED_BACK return ALREADY_ROLLED_BACK', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        runId: 'run-X',
        orgId: 'org-1',
        ruleId: 'rule-A',
        fieldName: 'thresholdValue',
        beforeValue: { value: 50 },
        afterValue:  { value: 55 },
        status: RuleTuningStatus.ROLLED_BACK,
      },
    ]);

    const service = buildService(prisma, simulationResponse([]));
    const result = await service.rollback('run-X', 'admin-1');

    expect(result.rolledBackCount).toBe(0);
    expect(result.alreadyRolledBackCount).toBe(1);
    // No mutations because nothing to undo.
    expect(prisma.optimizerRule.update).not.toHaveBeenCalled();
    expect(prisma.ruleTuningLog.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no logs exist for the runId', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([]);
    const service = buildService(prisma, simulationResponse([]));

    await expect(service.rollback('missing-run', 'admin-1')).rejects.toThrow(/No rule tuning logs/);
  });

  it('rolls back DISABLE_RULE by setting isEnabled back to its before-value (true)', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      {
        id: 'log-2',
        runId: 'run-Y',
        orgId: 'org-1',
        ruleId: 'rule-B',
        fieldName: 'isEnabled',
        beforeValue: { value: true },
        afterValue:  { value: false },
        status: RuleTuningStatus.APPLIED,
      },
    ]);
    const service = buildService(prisma, simulationResponse([]));

    await service.rollback('run-Y', 'admin-1');

    expect(prisma.optimizerRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-B' },
      data:  { isEnabled: true },
    });
  });
});

// ─── Phase J: history + observability + settings ─────────────────────────────

interface LogRowOverrides {
  id?: string;
  runId?: string;
  orgId?: string | null;
  ruleId?: string;
  changeType?: RuleTuningChangeType;
  fieldName?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  status?: RuleTuningStatus;
  triggeredByUserId?: string;
  appliedAt?: Date;
  rolledBackAt?: Date | null;
  rolledBackById?: string | null;
  rationale?: unknown;
}

function logRow(overrides: LogRowOverrides = {}) {
  return {
    id:                'log-' + Math.random().toString(36).slice(2),
    runId:             'run-1',
    orgId:             'org-1' as string | null,
    ruleId:            'rule-A',
    changeType:        RuleTuningChangeType.TIGHTEN_THRESHOLD,
    fieldName:         'thresholdValue',
    beforeValue:       { value: 50 },
    afterValue:        { value: 55 },
    status:            RuleTuningStatus.APPLIED,
    triggeredByUserId: 'u1',
    appliedAt:         new Date('2026-05-01T12:00:00Z'),
    rolledBackAt:      null as Date | null,
    rolledBackById:    null as string | null,
    rationale:         { confidence: 'HIGH' },
    ...overrides,
  };
}

// ─── Validators ──────────────────────────────────────────────────────────────

describe('settings validators', () => {
  it('validateBoolean accepts only booleans', () => {
    expect(validateBoolean(true)).toBe(true);
    expect(validateBoolean(false)).toBe(false);
    expect(validateBoolean('true')).toBeUndefined();
    expect(validateBoolean(1)).toBeUndefined();
    expect(validateBoolean(null)).toBeUndefined();
  });

  it('validateStringArray accepts arrays of strings', () => {
    expect(validateStringArray([])).toEqual([]);
    expect(validateStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(validateStringArray([1, 2])).toBeUndefined();
    expect(validateStringArray('a,b')).toBeUndefined();
    expect(validateStringArray(null)).toBeUndefined();
  });

  it('validatePositiveInt accepts non-negative finite numbers, floors to int', () => {
    expect(validatePositiveInt(0)).toBe(0);
    expect(validatePositiveInt(7)).toBe(7);
    expect(validatePositiveInt(7.9)).toBe(7);
    expect(validatePositiveInt(-1)).toBeUndefined();
    expect(validatePositiveInt(NaN)).toBeUndefined();
    expect(validatePositiveInt('5')).toBeUndefined();
  });

  it('validateRatio accepts numbers in [0, 1]', () => {
    expect(validateRatio(0)).toBe(0);
    expect(validateRatio(0.3)).toBe(0.3);
    expect(validateRatio(1)).toBe(1);
    expect(validateRatio(1.1)).toBeUndefined();
    expect(validateRatio(-0.1)).toBeUndefined();
    expect(validateRatio('0.5')).toBeUndefined();
  });
});

// ─── Pure helpers: groupLogsIntoRuns / summarizeRun ──────────────────────────

describe('groupLogsIntoRuns / summarizeRun', () => {
  it('groups logs by runId and sorts the result by startedAt desc', () => {
    const logs = [
      logRow({ id: 'l1', runId: 'r-A', appliedAt: new Date('2026-05-01T10:00:00Z') }),
      logRow({ id: 'l2', runId: 'r-B', appliedAt: new Date('2026-05-02T10:00:00Z') }),
      logRow({ id: 'l3', runId: 'r-A', appliedAt: new Date('2026-05-01T10:05:00Z') }),
    ];
    const runs = groupLogsIntoRuns(logs);
    expect(runs.map((r) => r.runId)).toEqual(['r-B', 'r-A']);

    const rA = runs.find((r) => r.runId === 'r-A')!;
    expect(rA.totalChanges).toBe(2);
    expect(rA.startedAt).toBe('2026-05-01T10:00:00.000Z');
    expect(rA.finishedAt).toBe('2026-05-01T10:05:00.000Z');
  });

  it('reports applied / rolled-back counts and the hasRollback flag', () => {
    const logs = [
      logRow({ status: RuleTuningStatus.APPLIED }),
      logRow({ status: RuleTuningStatus.ROLLED_BACK }),
    ];
    const r = summarizeRun(logs);
    expect(r.appliedCount).toBe(1);
    expect(r.rolledBackCount).toBe(1);
    expect(r.hasRollback).toBe(true);
  });

  it('cross-org runs surface scope=ALL when orgId is null', () => {
    const r = summarizeRun([logRow({ orgId: null })]);
    expect(r.scope).toBe('ALL');
  });

  it('preserves triggeredByUserId from the first log row', () => {
    const r = summarizeRun([
      logRow({ triggeredByUserId: 'admin-7', appliedAt: new Date('2026-05-01T08:00:00Z') }),
      logRow({ triggeredByUserId: 'admin-7', appliedAt: new Date('2026-05-01T08:30:00Z') }),
    ]);
    expect(r.triggeredByUserId).toBe('admin-7');
  });
});

// ─── Service: listRuns ───────────────────────────────────────────────────────

describe('RuleTunerService.listRuns', () => {
  it('returns runs scoped to a single org', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      logRow({ runId: 'r-1', orgId: 'org-1' }),
      logRow({ runId: 'r-2', orgId: 'org-1', appliedAt: new Date('2026-05-02T00:00:00Z') }),
    ]);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.listRuns('org-1', 25);
    expect(result.scope).toBe('org-1');
    expect(result.count).toBe(2);
    expect(result.runs.map((r) => r.runId)).toEqual(['r-2', 'r-1']);
    expect(prisma.ruleTuningLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org-1' } }),
    );
  });

  it('cross-org listing passes no orgId filter', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([logRow({ orgId: null })]);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.listRuns(null);
    expect(result.scope).toBe('ALL');
    expect(prisma.ruleTuningLog.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('caps the limit at 200 (and the take heuristic at 200×20)', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([]);
    const service = buildService(prisma, simulationResponse([]));

    await service.listRuns(null, 9999);
    expect(prisma.ruleTuningLog.findMany.mock.calls[0][0].take).toBe(4000);
  });

  it('rejects non-positive limits — clamps to 1', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([]);
    const service = buildService(prisma, simulationResponse([]));

    await service.listRuns(null, 0);
    expect(prisma.ruleTuningLog.findMany.mock.calls[0][0].take).toBe(20);
  });
});

// ─── Service: getRun ─────────────────────────────────────────────────────────

describe('RuleTunerService.getRun', () => {
  it('returns the per-run detail with extracted before/after values', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      logRow({
        id: 'log-1',
        runId: 'run-X',
        beforeValue: { value: 50 },
        afterValue: { value: 55 },
      }),
    ]);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getRun('run-X');

    expect(result.runId).toBe('run-X');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].logId).toBe('log-1');
    expect(result.entries[0].beforeValue).toBe(50);
    expect(result.entries[0].afterValue).toBe(55);
    expect(prisma.ruleTuningLog.findMany).toHaveBeenCalledWith({
      where: { runId: 'run-X' },
      orderBy: { appliedAt: 'asc' },
    });
  });

  it('surfaces rollback metadata on entries when status=ROLLED_BACK', async () => {
    const rolledAt = new Date('2026-05-03T00:00:00Z');
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      logRow({
        id: 'log-1',
        status: RuleTuningStatus.ROLLED_BACK,
        rolledBackAt: rolledAt,
        rolledBackById: 'admin-9',
      }),
    ]);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getRun('run-1');
    expect(result.hasRollback).toBe(true);
    expect(result.entries[0].status).toBe(RuleTuningStatus.ROLLED_BACK);
    expect(result.entries[0].rolledBackAt).toBe(rolledAt.toISOString());
    expect(result.entries[0].rolledBackById).toBe('admin-9');
  });

  it('throws NotFoundException when no logs exist for the runId', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([]);
    const service = buildService(prisma, simulationResponse([]));

    await expect(service.getRun('missing')).rejects.toThrow(/No rule tuning logs/);
  });
});

// ─── Service: getObservability ───────────────────────────────────────────────

describe('RuleTunerService.getObservability', () => {
  it('aggregates run counts, applied/rolled-back totals, and reports cooldown remaining', async () => {
    const lastApplied = new Date(Date.now() - 5 * 60_000);
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_cooldown_minutes': 60,
      },
      lastApplied,
    });
    prisma.ruleTuningLog.findMany.mockResolvedValue([
      logRow({ runId: 'r-1', status: RuleTuningStatus.APPLIED, appliedAt: lastApplied }),
      logRow({
        runId: 'r-2',
        status: RuleTuningStatus.ROLLED_BACK,
        appliedAt: new Date(Date.now() - 60 * 60_000),
      }),
    ]);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getObservability('org-1');

    expect(result.scope).toBe('org-1');
    expect(result.totalRuns).toBe(2);
    expect(result.totalAppliedChanges).toBe(1);
    expect(result.totalRolledBackChanges).toBe(1);
    expect(result.cooldownActive).toBe(true);
    expect(result.cooldownRemainingMinutes).not.toBeNull();
    expect(result.cooldownRemainingMinutes!).toBeGreaterThan(0);
    expect(result.cooldownRemainingMinutes!).toBeLessThanOrEqual(60);
    expect(result.cooldownExpiresAt).not.toBeNull();
    expect(result.lastAppliedRun?.runId).toBe('r-1');
    expect(result.recentRuns).toHaveLength(2);
  });

  it('reports null cooldown when no prior runs exist in scope', async () => {
    const prisma = buildPrisma();
    prisma.ruleTuningLog.findMany.mockResolvedValue([]);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getObservability(null);
    expect(result.totalRuns).toBe(0);
    expect(result.lastAppliedAt).toBeNull();
    expect(result.cooldownActive).toBe(false);
    expect(result.cooldownExpiresAt).toBeNull();
    expect(result.cooldownRemainingMinutes).toBeNull();
    expect(result.lastAppliedRun).toBeNull();
  });

  it('caps recentRuns at 10 even when more runs exist', async () => {
    const prisma = buildPrisma();
    const logs = Array.from({ length: 15 }, (_, i) =>
      logRow({ runId: `r-${i}`, appliedAt: new Date(2026, 4, i + 1) }),
    );
    prisma.ruleTuningLog.findMany.mockResolvedValue(logs);
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getObservability(null);
    expect(result.totalRuns).toBe(15);
    expect(result.recentRuns).toHaveLength(10);
  });
});

// ─── Service: getResolvedSettingsView ────────────────────────────────────────

describe('RuleTunerService.getResolvedSettingsView', () => {
  it('reports source=default when no admin_settings rows exist', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getResolvedSettingsView(null);
    expect(result.scope).toBe('ALL');
    expect(result.autoTuneEnabled).toEqual({ value: false, source: 'default' });
    expect(result.maxChangesPerRun).toEqual({ value: 10, source: 'default' });
    expect(result.cooldownMinutes).toEqual({ value: 60, source: 'default' });
    expect(result.maxActionDeltaRatio).toEqual({ value: 0.3, source: 'default' });
    expect(result.orgAllowlist).toEqual({ value: [], source: 'default' });
  });

  it('reports source=global when only the global row exists', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':              true,
        'learning.auto_tune_max_changes_per_run':  5,
        'learning.auto_tune_max_action_delta_ratio': 0.15,
      },
    });
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getResolvedSettingsView(null);
    expect(result.autoTuneEnabled).toEqual({ value: true, source: 'global' });
    expect(result.maxChangesPerRun).toEqual({ value: 5, source: 'global' });
    expect(result.maxActionDeltaRatio).toEqual({ value: 0.15, source: 'global' });
    // Unset keys still fall back to compile-time default.
    expect(result.cooldownMinutes.source).toBe('default');
  });

  it('reports source=org when an org override exists, falling through to global for the rest', async () => {
    const prisma = buildPrisma();
    prisma.adminSetting.findFirst = jest.fn().mockImplementation(({ where }: any) => {
      const map: Record<string, unknown> = {
        'org-1:learning.auto_tune_enabled': true,
        'GLOBAL:learning.auto_tune_max_changes_per_run': 7,
      };
      const lookup = where.orgId ? `${where.orgId}:${where.key}` : `GLOBAL:${where.key}`;
      const v = map[lookup];
      return v === undefined ? null : { value: v };
    });
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getResolvedSettingsView('org-1');
    expect(result.autoTuneEnabled).toEqual({ value: true, source: 'org' });
    expect(result.maxChangesPerRun).toEqual({ value: 7, source: 'global' });
    expect(result.cooldownMinutes.source).toBe('default');
  });

  it('falls through to the next layer when a row\'s value is malformed', async () => {
    const prisma = buildPrisma();
    prisma.adminSetting.findFirst = jest.fn().mockImplementation(({ where }: any) => {
      // Org-level row exists but stores garbage; the global row is fine.
      if (where.orgId === 'org-1' && where.key === 'learning.auto_tune_enabled') {
        return { value: 'definitely-not-a-bool' };
      }
      if (where.orgId === null && where.key === 'learning.auto_tune_enabled') {
        return { value: true };
      }
      return null;
    });
    const service = buildService(prisma, simulationResponse([]));

    const result = await service.getResolvedSettingsView('org-1');
    expect(result.autoTuneEnabled).toEqual({ value: true, source: 'global' });
  });
});

// ─── totalProjectedActionDelta wired into the run result ────────────────────

describe('RuleTunerService run result projected delta', () => {
  it('sums projectedActionDelta across applied changes', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
      rules: {
        'r-1': { thresholdValue: 50, isEnabled: true },
        'r-2': { thresholdValue: 60, isEnabled: true },
      },
    });
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-1', impact: impact({ projectedActionDelta: -5 }) }),
      ruleEntry({ ruleId: 'r-2', impact: impact({ projectedActionDelta: -3 }) }),
    ]);
    const service = buildService(prisma, sim);

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });
    expect(result.totals.appliedCount).toBe(2);
    expect(result.totals.totalProjectedActionDelta).toBe(-8);
  });

  it('dry-run also reports projected impact even though nothing is written', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
      rules: {
        'r-1': { thresholdValue: 50, isEnabled: true },
      },
    });
    const sim = simulationResponse([
      ruleEntry({ ruleId: 'r-1', impact: impact({ projectedActionDelta: -7 }) }),
    ]);
    const service = buildService(prisma, sim);

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1', dryRun: true });
    expect(result.totals.skippedCount).toBe(1);
    expect(result.totals.totalProjectedActionDelta).toBe(-7);
  });

  it('blocked candidates do not contribute to the delta sum', async () => {
    const prisma = buildPrisma({
      settings: {
        'learning.auto_tune_enabled':       true,
        'learning.auto_tune_org_allowlist': ['org-1'],
      },
      rules: {
        'r-1': { thresholdValue: 50, isEnabled: true },
      },
    });
    const sim = simulationResponse([
      ruleEntry({
        ruleId: 'r-1',
        impact: impact({ confidence: SimulationConfidence.LOW, projectedActionDelta: -100 }),
      }),
    ]);
    const service = buildService(prisma, sim);

    const result = await service.run({ orgId: 'org-1', triggeredByUserId: 'u1' });
    expect(result.totals.blockedCount).toBe(1);
    expect(result.totals.totalProjectedActionDelta).toBe(0);
  });
});
