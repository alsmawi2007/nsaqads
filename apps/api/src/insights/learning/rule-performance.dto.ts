import { ApiProperty } from '@nestjs/swagger';
import { RuleHealth, RuleHealthConfidence, RuleRecommendedAction } from './rule-performance.types';

export class RuleFeedbackBreakdownDto {
  @ApiProperty() interactionCount!: number;
  @ApiProperty() withFeedbackCount!: number;
  @ApiProperty() usefulCount!: number;
  @ApiProperty() notUsefulCount!: number;
  @ApiProperty() wrongCount!: number;
  @ApiProperty() needsMoreContextCount!: number;
  @ApiProperty({ description: 'USEFUL / withFeedbackCount.' })             usefulRate!: number;
  @ApiProperty({ description: 'NOT_USEFUL / withFeedbackCount.' })         notUsefulRate!: number;
  @ApiProperty({ description: 'WRONG / withFeedbackCount.' })              wrongRate!: number;
  @ApiProperty({ description: 'NEEDS_MORE_CONTEXT / withFeedbackCount.' }) needsMoreContextRate!: number;
}

export class RuleHealthHooksDto {
  @ApiProperty({
    enum: RuleRecommendedAction,
    description:
      'Advisory only — what the system *might* do automatically in a future phase. ' +
      'Currently no callsite acts on this; it is output for the admin UI.',
  })
  recommendedAction!: RuleRecommendedAction;

  @ApiProperty({ description: 'Suggested next ruleScore floor. Null when not applicable.' })
  proposedScoreFloor!: number | null;

  @ApiProperty({ description: 'Suggested threshold-multiplier delta to widen / tighten the rule. Null when not applicable.' })
  proposedThresholdDelta!: number | null;

  @ApiProperty({ description: 'Whether the system would consider disabling this rule given current evidence. Read-only flag.' })
  shouldConsiderDisable!: boolean;
}

export class RuleHealthEntryDto {
  @ApiProperty({ description: 'Rule id from optimizer_rules. Stable across updates.' })
  ruleId!: string;

  @ApiProperty({ description: 'Org id when the analytics are scoped to one org; "ALL" when admin view aggregates across all orgs.' })
  scope!: string;

  @ApiProperty({ enum: RuleHealth })
  health!: RuleHealth;

  @ApiProperty({ enum: RuleHealthConfidence })
  confidence!: RuleHealthConfidence;

  @ApiProperty({ description: 'Normalized 0..100 score combining useful / wrong / context / sample-size factors.' })
  ruleScore!: number;

  @ApiProperty({ type: [String], description: 'Reasons supporting the classification — human-readable, suitable for tooltip.' })
  reasons!: string[];

  @ApiProperty({ type: RuleFeedbackBreakdownDto })
  breakdown!: RuleFeedbackBreakdownDto;

  @ApiProperty({ type: RuleHealthHooksDto, description: 'Advisory hooks for future automated tuning. Read-only today.' })
  hooks!: RuleHealthHooksDto;
}

export class RuleHealthSummaryDto {
  @ApiProperty()
  totalRules!: number;

  @ApiProperty({ description: 'Count of rules in each health band.' })
  byHealth!: Record<RuleHealth, number>;

  @ApiProperty({ description: 'Average ruleScore across non-LOW_SIGNAL rules.' })
  averageRuleScore!: number;
}

export class RuleHealthResponseDto {
  @ApiProperty({ description: 'Org id when scoped; "ALL" for cross-org admin view.' })
  scope!: string;

  @ApiProperty({ type: RuleHealthSummaryDto })
  summary!: RuleHealthSummaryDto;

  @ApiProperty({ type: [RuleHealthEntryDto] })
  rules!: RuleHealthEntryDto[];

  @ApiProperty({ description: 'Rows with feedback / status but no relatedRuleId (e.g. trend insights, learning-phase notices).' })
  uncategorizedCount!: number;

  @ApiProperty()
  generatedAt!: string;
}
