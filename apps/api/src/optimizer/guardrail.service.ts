import { Injectable, Logger } from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { ProposedAction } from './dto/proposed-action.dto';
import { CooldownService } from './cooldown.service';
import { applyDelta } from '../common/utils/currency.util';

export interface GuardrailResult {
  approved: ProposedAction[];
  skipped: Array<{ action: ProposedAction; reason: string }>;
}

// R1 from approval: budget action types that count toward the one-per-entity-per-cycle limit
const MAJOR_BUDGET_ACTIONS: ActionType[] = [ActionType.INCREASE_BUDGET, ActionType.DECREASE_BUDGET];

// R2 from approval: maximum single-step delta to prevent abrupt swings
const ABRUPT_SWING_THRESHOLD_PCT = 50;

@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);

  constructor(private cooldown: CooldownService) {}

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
}
