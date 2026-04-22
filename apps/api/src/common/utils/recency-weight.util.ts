export interface WindowedMetric {
  window24h: number | null;
  window48h: number | null;
  window72h: number | null;
}

// Weights: 24h data is most recent and carries the most influence.
const WEIGHTS = { w24: 0.6, w48: 0.3, w72: 0.1 };

export function applyRecencyWeight(metric: WindowedMetric): number | null {
  const { window24h, window48h, window72h } = metric;

  // Need at least the 24h window to make a decision
  if (window24h === null) return null;

  if (window48h === null && window72h === null) return window24h;

  if (window72h === null) {
    // Redistribute weights between 24h and 48h
    const total = WEIGHTS.w24 + WEIGHTS.w48;
    return (window24h * WEIGHTS.w24 + window48h! * WEIGHTS.w48) / total;
  }

  return window24h * WEIGHTS.w24 + window48h! * WEIGHTS.w48 + window72h * WEIGHTS.w72;
}

export function computeSpendPacing(actualSpend: number, dailyBudget: number | null): number {
  if (!dailyBudget || dailyBudget === 0) return 0;
  return actualSpend / dailyBudget;
}
