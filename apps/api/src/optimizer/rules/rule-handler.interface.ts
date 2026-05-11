import { ActionType, OptimizerRule, Platform } from '@prisma/client';
import { ProposedAction } from '../dto/proposed-action.dto';

// Codes for why a rule did not produce a ProposedAction. Stable string
// constants so the future Insights layer can group, filter, and translate
// them without parsing free-form text.
export type SkipReasonCode =
  | 'KPI_MISSING'
  | 'INSUFFICIENT_SAMPLE'
  | 'THRESHOLD_NOT_MET'
  | 'MISSING_BASELINE'
  | 'NOT_APPLICABLE';

export interface SkipReason {
  ruleId: string;
  entityType: 'CAMPAIGN' | 'AD_SET';
  entityId: string;
  actionType: ActionType;
  code: SkipReasonCode;
  reason: { en: string; ar: null };
  context?: Record<string, unknown>;
}

// Result of a single handler call: either a ProposedAction or a SkipReason.
// Discriminated union so callers don't need to inspect both fields.
export type RuleHandlerResult =
  | { kind: 'proposed'; action: ProposedAction }
  | { kind: 'skipped'; reason: SkipReason };

// Aggregate output of evaluating all rules for one entity. Insights layer
// will consume both arrays — proposed for "what we'd do" and skipped for
// "why nothing fired."
export interface EvaluationResult {
  proposed: ProposedAction[];
  skipped: SkipReason[];
}

// Provider-agnostic context for rule evaluation. The handler does not see
// concrete Campaign/AdSet rows — only the normalized inputs it needs to
// decide whether the rule fires and to construct a ProposedAction.
export interface RuleHandlerContext {
  orgId: string;
  entityType: 'CAMPAIGN' | 'AD_SET';
  entityId: string;
  platform: Platform;
  adAccountId: string;
  adAccountCurrency: string;
  // Weighted KPI values keyed by rule.kpiMetric (roas, cpa, cpc, ctr, spendPacing).
  // Plus 'impressions24h' for sample-size gating.
  metrics: Record<string, number | null>;
  // Current absolute value for budget-style rules. null when the entity does
  // not carry a baseline (e.g. ad-set budget when the parent uses CBO, or
  // bidding/bid-limit rules where current bid is not loaded).
  currentBaseline: number | null;
}

export interface IRuleHandler {
  // Set of ActionType values this handler is responsible for. The evaluator
  // dispatches by matching rule.actionType against this set.
  readonly supports: ReadonlySet<ActionType>;

  // Evaluate one rule against one entity. Pure function: no DB access, no
  // network. Determinism makes the Insights layer's replay use case trivial.
  evaluate(rule: OptimizerRule, ctx: RuleHandlerContext): RuleHandlerResult;
}
