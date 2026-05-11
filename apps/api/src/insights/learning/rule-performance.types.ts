// Rule health classification — the qualitative read on whether a rule is
// pulling its weight. Drives admin UX and (eventually) automated decisions.
export enum RuleHealth {
  // Sufficient sample + good usefulRate + low wrongRate → keep as-is.
  HEALTHY = 'HEALTHY',
  // Sufficient sample but verdicts are bad enough to suggest threshold tuning.
  NEEDS_TUNING = 'NEEDS_TUNING',
  // Sufficient sample, but verdicts are split (~equal useful and wrong) —
  // the rule fires correctly for some users / scenarios and not others,
  // suggesting context-dependence rather than a wrong threshold.
  UNSTABLE = 'UNSTABLE',
  // Not enough interactions to reliably classify in any direction.
  LOW_SIGNAL = 'LOW_SIGNAL',
}

// Suggestion the system *might* act on automatically in a later phase. For
// now this is purely advisory output exposed to admins — no callsite in
// the codebase consumes it for behavioral changes yet.
export enum RuleRecommendedAction {
  NO_ACTION         = 'NO_ACTION',
  COLLECT_MORE_DATA = 'COLLECT_MORE_DATA',
  REVIEW            = 'REVIEW',
  CONSIDER_TUNING   = 'CONSIDER_TUNING',
  CONSIDER_DISABLE  = 'CONSIDER_DISABLE',
}

// Confidence that the verdict above is statistically meaningful — derived
// from interaction sample size, not from feedback ratios. A 100% useful rate
// with one interaction is LOW confidence; a 60% useful rate over 200
// interactions is HIGH.
export enum RuleHealthConfidence {
  LOW    = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH   = 'HIGH',
}

// Sample-size cutoffs (per rule). Below MIN, the rule is LOW_SIGNAL;
// above HIGH_SAMPLE, the sample-size confidence factor saturates.
export const SAMPLE_THRESHOLDS = {
  MIN_FOR_CLASSIFICATION: 10,  // < 10 → LOW_SIGNAL
  MEDIUM_CONFIDENCE: 30,
  HIGH_CONFIDENCE:   100,
} as const;

// Feedback-rate cutoffs. Tuned conservatively — a future phase can read
// them from AdminSetting. Numbers below assume rates are 0..1.
export const RATE_THRESHOLDS = {
  HEALTHY_USEFUL_MIN:   0.65,
  HEALTHY_WRONG_MAX:    0.15,
  TUNING_WRONG_MIN:     0.30,
  UNSTABLE_USEFUL_MIN:  0.25,
  UNSTABLE_WRONG_MIN:   0.25,
} as const;

// Weights for the normalized ruleScore (0..100). Sum must equal 1.0.
// Heavier on usefulRate (the positive signal) than on wrongRate inverse,
// with a small bonus for sample size so a rule with many useful verdicts
// scores above one with the same rates but tiny volume.
export const SCORE_WEIGHTS = {
  USEFUL:         0.50,
  NOT_WRONG:      0.30, // (1 - wrongRate)
  NOT_NEEDS_CTX:  0.10, // (1 - needsMoreContextRate)
  SAMPLE:         0.10, // saturating factor of interactionCount
} as const;
