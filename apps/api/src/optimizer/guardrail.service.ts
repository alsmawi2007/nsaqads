import { Injectable, Logger } from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { ProposedAction } from './dto/proposed-action.dto';
import { CooldownService } from './cooldown.service';
import { ProviderFactory } from '../providers/factory/provider.factory';
import {
  ProviderCapabilities,
  BiddingStrategy,
} from '../providers/interfaces/ad-provider.interface';
import { applyDelta } from '../common/utils/currency.util';

export interface GuardrailResult {
  approved: ProposedAction[];
  skipped: Array<{ action: ProposedAction; reason: string }>;
}

// R1 from approval: budget action types that count toward the one-per-entity-per-cycle limit
const MAJOR_BUDGET_ACTIONS: ActionType[] = [ActionType.INCREASE_BUDGET, ActionType.DECREASE_BUDGET];

// R2 from approval: maximum single-step delta to prevent abrupt swings
const ABRUPT_SWING_THRESHOLD_PCT = 50;

// Stable, machine-readable skip reason for capability-blocked actions. The
// human-readable suffix names which capability is missing.
export const UNSUPPORTED_BY_PROVIDER = 'UNSUPPORTED_BY_PROVIDER';

@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);

  constructor(
    private cooldown: CooldownService,
    private providerFactory: ProviderFactory,
  ) {}

  async validate(
    actions: ProposedAction[],
    settings: Record<string, unknown>,
  ): Promise<GuardrailResult> {
    // R1: Sort by priority (lower value = higher priority) before evaluation
    const sorted = [...actions].sort((a, b) => a.rulePriority - b.rulePriority);

    const approved: ProposedAction[] = [];
    const skipped: Array<{ action: ProposedAction; reason: string }> = [];

    // Tracks which entities have already received a major budget action this cycle
    const budgetActionsThisCycle = new Set<string>();

    const maxIncreasePct = settings['optimizer.max_budget_increase_pct'] as number ?? 30;
    const maxDecreasePct = settings['optimizer.max_budget_decrease_pct'] as number ?? 20;
    const cooldownHours = settings['optimizer.cooldown_hours'] as number ?? 24;

    for (const action of sorted) {
      const entityKey = `${action.entityType}:${action.entityId}`;

      // G0: Capability gate — refuse to propose actions the provider can't honor.
      // Runs before any other check because cooldown/delta/swing are irrelevant
      // if the platform fundamentally does not support the action.
      const capabilityFailure = this.checkCapability(action);
      if (capabilityFailure) {
        skipped.push({ action, reason: `${UNSUPPORTED_BY_PROVIDER}: ${capabilityFailure}` });
        this.logger.warn(
          `Capability gate skipped ${action.actionType} on ${action.platform} ${entityKey}: ${capabilityFailure}`,
        );
        continue;
      }

      // G1: Cooldown check
      const onCooldown = await this.cooldown.isOnCooldown(
        action.entityType, action.entityId, action.actionType,
      );
      if (onCooldown) {
        skipped.push({ action, reason: 'Entity is within cooldown window' });
        continue;
      }

      // G3: One major budget action per entity per cycle
      if (MAJOR_BUDGET_ACTIONS.includes(action.actionType) && budgetActionsThisCycle.has(entityKey)) {
        skipped.push({ action, reason: 'Entity already received a budget action this cycle' });
        continue;
      }

      // G4: Abrupt swing prevention
      if (action.deltaPct !== null && Math.abs(action.deltaPct) > ABRUPT_SWING_THRESHOLD_PCT) {
        skipped.push({
          action,
          reason: `Proposed delta ${action.deltaPct}% exceeds abrupt swing threshold of ${ABRUPT_SWING_THRESHOLD_PCT}%`,
        });
        this.logger.warn(`Abrupt swing rejected for entity ${action.entityId}: ${action.deltaPct}%`);
        continue;
      }

      // G2: Delta cap — clamp rather than reject
      if (action.actionType === ActionType.INCREASE_BUDGET && action.deltaPct !== null) {
        if (action.deltaPct > maxIncreasePct) {
          this.logger.log(`Clamping increase delta from ${action.deltaPct}% to ${maxIncreasePct}%`);
          action.deltaPct = maxIncreasePct;
          if (action.currentValue !== null) {
            action.proposedValue = applyDelta(action.currentValue, maxIncreasePct, action.adAccountCurrency);
          }
        }
      }
      if (action.actionType === ActionType.DECREASE_BUDGET && action.deltaPct !== null) {
        const absDelta = Math.abs(action.deltaPct);
        if (absDelta > maxDecreasePct) {
          this.logger.log(`Clamping decrease delta from ${action.deltaPct}% to -${maxDecreasePct}%`);
          action.deltaPct = -maxDecreasePct;
          if (action.currentValue !== null) {
            action.proposedValue = applyDelta(action.currentValue, -maxDecreasePct, action.adAccountCurrency);
          }
        }
      }

      // All guardrails passed
      approved.push(action);

      if (MAJOR_BUDGET_ACTIONS.includes(action.actionType)) {
        budgetActionsThisCycle.add(entityKey);
      }
    }

    return { approved, skipped };
  }

  // Returns the missing capability name when the action is blocked, null when
  // the provider can honor the action. The optimizer treats a returned name as
  // the human-readable suffix on UNSUPPORTED_BY_PROVIDER skip reasons.
  private checkCapability(action: ProposedAction): string | null {
    const caps: ProviderCapabilities = this.providerFactory.getProvider(action.platform).getCapabilities();

    switch (action.actionType) {
      case ActionType.ADJUST_BID_FLOOR:
        return caps.supportsBidFloor ? null : 'supportsBidFloor=false';

      case ActionType.ADJUST_BID_CEILING:
        return caps.supportsBidCeiling ? null : 'supportsBidCeiling=false';

      case ActionType.INCREASE_BUDGET:
      case ActionType.DECREASE_BUDGET:
        // CAMPAIGN-level budget actions are produced by the evaluator only
        // when the campaign is CBO (the evaluator filters AD_SET budget rules
        // out for CBO campaigns). So a CAMPAIGN budget action implies CBO.
        if (action.entityType === 'CAMPAIGN' && !caps.supportsCbo) {
          return 'supportsCbo=false';
        }
        return null;

      case ActionType.SWITCH_BIDDING_STRATEGY: {
        if (action.targetValue === BiddingStrategy.TARGET_ROAS && !caps.supportsRoasGoal) {
          return 'supportsRoasGoal=false';
        }
        if (action.targetValue === BiddingStrategy.TARGET_CPA && !caps.supportsCpaGoal) {
          return 'supportsCpaGoal=false';
        }
        return null;
      }

      default:
        return null;
    }
  }
}
