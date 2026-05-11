import { ActionType, Platform } from '@prisma/client';
import { GuardrailService, UNSUPPORTED_BY_PROVIDER } from './guardrail.service';
import { CooldownService } from './cooldown.service';
import { ProviderFactory } from '../providers/factory/provider.factory';
import {
  BiddingStrategy,
  ProviderCapabilities,
} from '../providers/interfaces/ad-provider.interface';
import { ProposedAction } from './dto/proposed-action.dto';

// Capability descriptor mirroring Meta's real shape: bid floor unsupported,
// CBO and ceiling supported. Used to assert that the guardrail blocks the
// right actions for the right reasons.
const META_LIKE_CAPS: ProviderCapabilities = {
  supportsCbo:              true,
  supportsLifetimeBudget:   true,
  supportsBidFloor:         false,
  supportsBidCeiling:       true,
  supportsRoasGoal:         true,
  supportsCpaGoal:          true,
  supportsCampaignCreation: false,
  supportsCreativeUpload:   false,
};

const ALL_TRUE_CAPS: ProviderCapabilities = {
  supportsCbo:              true,
  supportsLifetimeBudget:   true,
  supportsBidFloor:         true,
  supportsBidCeiling:       true,
  supportsRoasGoal:         true,
  supportsCpaGoal:          true,
  supportsCampaignCreation: true,
  supportsCreativeUpload:   true,
};

function makeAction(overrides: Partial<ProposedAction>): ProposedAction {
  return {
    orgId: 'org-1',
    ruleId: 'rule-1',
    entityType: 'AD_SET',
    entityId: 'adset-1',
    platform: 'META' as Platform,
    actionType: ActionType.ADJUST_BID_FLOOR,
    deltaPct: null,
    targetValue: null,
    currentValue: null,
    proposedValue: 1.5,
    explanation: { en: 'test', ar: null },
    rulePriority: 100,
    adAccountId: 'acc-1',
    adAccountCurrency: 'SAR',
    ...overrides,
  };
}

function makeFactory(caps: ProviderCapabilities): ProviderFactory {
  return {
    getProvider: () => ({ getCapabilities: () => caps } as unknown as ReturnType<ProviderFactory['getProvider']>),
  } as unknown as ProviderFactory;
}

const cooldownNeverFires: CooldownService = {
  isOnCooldown: jest.fn().mockResolvedValue(false),
} as unknown as CooldownService;

describe('GuardrailService — capability gating', () => {
  it('skips ADJUST_BID_FLOOR when supportsBidFloor=false (Meta-like)', async () => {
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(META_LIKE_CAPS));

    const action = makeAction({ actionType: ActionType.ADJUST_BID_FLOOR });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].action).toBe(action);
    expect(skipped[0].reason).toContain(UNSUPPORTED_BY_PROVIDER);
    expect(skipped[0].reason).toContain('supportsBidFloor=false');
  });

  it('approves ADJUST_BID_CEILING when supportsBidCeiling=true', async () => {
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(META_LIKE_CAPS));

    const action = makeAction({ actionType: ActionType.ADJUST_BID_CEILING, proposedValue: 2.5 });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toEqual([action]);
    expect(skipped).toHaveLength(0);
  });

  it('skips ADJUST_BID_CEILING when supportsBidCeiling=false', async () => {
    const noCeilingCaps: ProviderCapabilities = { ...ALL_TRUE_CAPS, supportsBidCeiling: false };
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(noCeilingCaps));

    const action = makeAction({ actionType: ActionType.ADJUST_BID_CEILING, proposedValue: 2.5 });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toHaveLength(0);
    expect(skipped[0].reason).toContain('supportsBidCeiling=false');
  });

  it('skips CAMPAIGN-level INCREASE_BUDGET when supportsCbo=false', async () => {
    const noCboCaps: ProviderCapabilities = { ...ALL_TRUE_CAPS, supportsCbo: false };
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(noCboCaps));

    const action = makeAction({
      actionType: ActionType.INCREASE_BUDGET,
      entityType: 'CAMPAIGN',
      entityId: 'campaign-1',
      currentValue: 100,
      proposedValue: 115,
      deltaPct: 15,
    });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toHaveLength(0);
    expect(skipped[0].reason).toContain('supportsCbo=false');
  });

  it('approves AD_SET-level INCREASE_BUDGET when supportsCbo=false (capability does not gate ad-set budget)', async () => {
    const noCboCaps: ProviderCapabilities = { ...ALL_TRUE_CAPS, supportsCbo: false };
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(noCboCaps));

    const action = makeAction({
      actionType: ActionType.INCREASE_BUDGET,
      entityType: 'AD_SET',
      currentValue: 100,
      proposedValue: 115,
      deltaPct: 15,
    });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toEqual([action]);
    expect(skipped).toHaveLength(0);
  });

  it('skips SWITCH_BIDDING_STRATEGY to TARGET_ROAS when supportsRoasGoal=false', async () => {
    const noRoasCaps: ProviderCapabilities = { ...ALL_TRUE_CAPS, supportsRoasGoal: false };
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(noRoasCaps));

    const action = makeAction({
      actionType: ActionType.SWITCH_BIDDING_STRATEGY,
      targetValue: BiddingStrategy.TARGET_ROAS,
    });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toHaveLength(0);
    expect(skipped[0].reason).toContain('supportsRoasGoal=false');
  });

  it('approves SWITCH_BIDDING_STRATEGY to LOWEST_COST regardless of ROAS/CPA support', async () => {
    const noGoalCaps: ProviderCapabilities = {
      ...ALL_TRUE_CAPS,
      supportsRoasGoal: false,
      supportsCpaGoal: false,
    };
    const guardrail = new GuardrailService(cooldownNeverFires, makeFactory(noGoalCaps));

    const action = makeAction({
      actionType: ActionType.SWITCH_BIDDING_STRATEGY,
      targetValue: BiddingStrategy.LOWEST_COST,
    });
    const { approved, skipped } = await guardrail.validate([action], {});

    expect(approved).toEqual([action]);
    expect(skipped).toHaveLength(0);
  });

  it('runs capability gate before cooldown — does not consult Redis for unsupported actions', async () => {
    const cooldownSpy = jest.fn().mockResolvedValue(false);
    const cooldown: CooldownService = { isOnCooldown: cooldownSpy } as unknown as CooldownService;
    const guardrail = new GuardrailService(cooldown, makeFactory(META_LIKE_CAPS));

    const action = makeAction({ actionType: ActionType.ADJUST_BID_FLOOR });
    await guardrail.validate([action], {});

    expect(cooldownSpy).not.toHaveBeenCalled();
  });
});
