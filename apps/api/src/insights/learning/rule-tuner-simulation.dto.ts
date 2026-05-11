import { ApiProperty } from '@nestjs/swagger';
import { RuleHealth } from './rule-performance.types';

export enum SimulatedActionType {
  NO_CHANGE         = 'NO_CHANGE',
  TIGHTEN_THRESHOLD = 'TIGHTEN_THRESHOLD',
  DISABLE_RULE      = 'DISABLE_RULE',
  RAISE_SCORE_FLOOR = 'RAISE_SCORE_FLOOR',
}

export enum SimulationConfidence {
  LOW    = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH   = 'HIGH',
}

export class RuleSimulationActionDto {
  @ApiProperty({ enum: SimulatedActionType })
  type!: SimulatedActionType;

  @ApiProperty({ description: 'Human-readable description of the proposed change.' })
  description!: string;

  @ApiProperty({
    description:
      'Multiplier delta on the rule\'s threshold_value if this were applied. Null when the action is not threshold-related.',
  })
  proposedThresholdDelta!: number | null;

  @ApiProperty({
    description:
      'Numerically projected new threshold value (current × applied delta) for TIGHTEN_THRESHOLD. Null otherwise or when the rule definition is unavailable.',
  })
  projectedNewThreshold!: number | null;

  @ApiProperty({
    description: 'Suggested score floor for this rule\'s insights. Null unless RAISE_SCORE_FLOOR.',
  })
  proposedScoreFloor!: number | null;

  @ApiProperty({ description: 'Whether the simulation would disable the rule outright.' })
  shouldDisable!: boolean;
}

export class RuleSimulationImpactDto {
  @ApiProperty({ description: 'InsightInteraction count fed into the rule-health classifier (current state).' })
  currentInteractionCount!: number;

  @ApiProperty({
    description: 'OptimizerAction count for this rule observed within the simulation lookback window.',
  })
  currentActionCount!: number;

  @ApiProperty({
    description:
      'Projected OptimizerAction count after applying the simulated change. Equals currentActionCount when the action is NO_CHANGE or RAISE_SCORE_FLOOR.',
  })
  projectedActionCount!: number;

  @ApiProperty({
    description:
      'projectedActionCount - currentActionCount. Negative for tightening or disable; zero otherwise.',
  })
  projectedActionDelta!: number;

  @ApiProperty({
    description: 'How many of the historical actions would be suppressed under the simulated change.',
  })
  suppressedActionCount!: number;

  @ApiProperty({
    description:
      'Historical actions whose evaluation_context did not contain a usable KPI value, so their fate could not be re-evaluated.',
  })
  indeterminateActionCount!: number;

  @ApiProperty({ enum: SimulationConfidence })
  confidence!: SimulationConfidence;

  @ApiProperty({
    type: [String],
    description: 'Per-rule notes explaining how the projection was derived.',
  })
  notes!: string[];
}

export class RuleSimulationEntryDto {
  @ApiProperty()
  ruleId!: string;

  @ApiProperty({ description: '"ALL" for cross-org scope; otherwise the orgId.' })
  scope!: string;

  @ApiProperty({ enum: RuleHealth })
  currentHealth!: RuleHealth;

  @ApiProperty({ description: '0..100 ruleScore from RulePerformanceService.' })
  currentRuleScore!: number;

  @ApiProperty({ type: RuleSimulationActionDto })
  action!: RuleSimulationActionDto;

  @ApiProperty({ type: RuleSimulationImpactDto })
  impact!: RuleSimulationImpactDto;
}

export class RuleSimulationSummaryDto {
  @ApiProperty()
  totalRules!: number;

  @ApiProperty({
    description:
      'Distribution of rules across simulated action types. NO_CHANGE includes UNSTABLE and LOW_SIGNAL — review-only or insufficient-signal verdicts.',
  })
  rulesByAction!: Record<SimulatedActionType, number>;

  @ApiProperty()
  totalCurrentInteractions!: number;

  @ApiProperty({ description: 'Sum of OptimizerAction rows across all simulated rules.' })
  totalCurrentActions!: number;

  @ApiProperty({
    description:
      'Net change in projected OptimizerAction firings across all rules. Negative means the simulation would suppress firings overall.',
  })
  totalProjectedActionDelta!: number;

  @ApiProperty({ description: 'Count of rules whose impact projection has HIGH confidence.' })
  highConfidenceRuleCount!: number;
}

export class RuleSimulationResponseDto {
  @ApiProperty({ description: '"ALL" for cross-org admin view; otherwise the orgId.' })
  scope!: string;

  @ApiProperty({ description: 'Days of OptimizerAction history that fed the projection.' })
  lookbackDays!: number;

  @ApiProperty({ type: RuleSimulationSummaryDto })
  summary!: RuleSimulationSummaryDto;

  @ApiProperty({ type: [RuleSimulationEntryDto] })
  rules!: RuleSimulationEntryDto[];

  @ApiProperty({
    description:
      'Always true. Marker on the response that no rules were modified — the data is purely projected.',
  })
  isShadowMode!: true;

  @ApiProperty({ description: 'Rule-health rows that were uncategorized (no relatedRuleId).' })
  uncategorizedCount!: number;

  @ApiProperty()
  generatedAt!: string;
}
