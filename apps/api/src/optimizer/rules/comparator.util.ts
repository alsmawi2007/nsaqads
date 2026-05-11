// Comparator semantics shared by every rule handler. Extracted from the
// evaluator so the same operator set is enforced everywhere — including
// the future Insights layer when it replays "would this rule have fired?"

export type Comparator = 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ';

export function compare(value: number, comparator: string, threshold: number): boolean {
  switch (comparator) {
    case 'GT':  return value > threshold;
    case 'LT':  return value < threshold;
    case 'GTE': return value >= threshold;
    case 'LTE': return value <= threshold;
    case 'EQ':  return value === threshold;
    default:    return false;
  }
}
