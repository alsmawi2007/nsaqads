import { ActionType, Platform } from '@prisma/client';
import { BiddingStrategy } from '../../providers/interfaces/ad-provider.interface';

export interface ProposedAction {
  orgId: string;
  ruleId: string;
  entityType: 'CAMPAIGN' | 'AD_SET';
  entityId: string;
  platform: Platform;
  actionType: ActionType;
  deltaPct: number | null;           // Percentage delta for budget actions
  targetValue: string | null;        // e.g. target BiddingStrategy for SWITCH
  currentValue: number | null;       // Current budget or bid value
  proposedValue: number | null;      // Computed absolute value after delta
  explanation: { en: string; ar: null };
  rulePriority: number;              // For priority-layer sorting (R1 from approval)
  adAccountId: string;
  adAccountCurrency: string;
}
