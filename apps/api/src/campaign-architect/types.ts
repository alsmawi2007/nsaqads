import {
  BudgetType,
  CampaignGoal,
  FunnelStage,
  Platform,
} from '@prisma/client';
import {
  BiddingStrategy,
  NormalizedAudience,
} from '../providers/interfaces/ad-provider.interface';
import { WizardInputDto } from './dto/wizard-input.dto';

export type AdAccountStatusLite =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'MOCK';

export interface ConnectedAdAccount {
  id: string;
  platform: Platform;
  currency: string | null;
  status: AdAccountStatusLite;
  deletedAt: Date | null;
}

export interface OrgSettings {
  defaultCurrency?: string;
}

export interface DecisionEngineContext {
  input: WizardInputDto;
  orgSettings: OrgSettings;
  adAccounts: ConnectedAdAccount[];
}

export interface CreativeRef {
  formats: string[];
  assetRefs: string[];
  headline: string | null;
  description: string | null;
  cta: string | null;
  landingUrl: string | null;
  pixelInstalled: boolean | null;
}

export interface PlanItemDraft {
  platform: Platform;
  adAccountId: string;
  objective: string;
  dailyBudget: number;
  isCbo: boolean;
  biddingStrategy: BiddingStrategy;
  bidTarget: number | null;
  audience: NormalizedAudience;
  creativeRef: CreativeRef;
}

export interface PlanDraftGeography {
  countries: string[];
  cities: string[] | null;
  radiusKm: number | null;
}

export interface PlanDraftAudienceHints {
  ageMin: number;
  ageMax: number;
  genders: string[];
  languages: string[] | null;
  interestTags: string[] | null;
}

export interface BudgetAllocationEntry {
  platform: Platform;
  sharePct: number;
  dailyBudget: number;
  rationale: string;
}

export interface ReasoningTrace {
  goalToFunnel: { goal: CampaignGoal; funnelStage: FunnelStage };
  supportedPlatforms: {
    requested: Platform[];
    accepted: Platform[];
    rejected: Platform[];
  };
  platformObjectives: Array<{
    platform: Platform;
    objective: string;
    rationale: string;
  }>;
  budgetAllocation: {
    durationDays: number | null;
    currency: string;
    budgetType: BudgetType;
    totalBudget: number;
    perPlatform: BudgetAllocationEntry[];
  };
  biddingStrategies: Array<{
    platform: Platform;
    strategy: BiddingStrategy;
    bidTarget: number | null;
    rationale: string;
  }>;
  cboDecisions: Array<{
    platform: Platform;
    isCbo: boolean;
    rationale: string;
  }>;
  audienceDefaults: { rationale: string };
}

export interface PlanDraft {
  goal: CampaignGoal;
  funnelStage: FunnelStage;
  totalBudget: number;
  budgetType: BudgetType;
  currency: string;
  startDate: string;
  endDate: string | null;
  durationDays: number | null;
  geography: PlanDraftGeography;
  audienceHints: PlanDraftAudienceHints;
  creativeBrief: CreativeRef;
  wizardAnswers: WizardInputDto;
  reasoning: ReasoningTrace;
  items: PlanItemDraft[];
}
