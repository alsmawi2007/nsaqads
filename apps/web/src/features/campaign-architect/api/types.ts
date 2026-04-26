// Mirrors apps/api/src/campaign-architect/dto/*.dto.ts

export type Platform = 'META' | 'TIKTOK' | 'GOOGLE_ADS' | 'SNAPCHAT';

export type CampaignGoal =
  | 'AWARENESS'
  | 'TRAFFIC'
  | 'ENGAGEMENT'
  | 'LEADS'
  | 'SALES'
  | 'APP_INSTALLS';

export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';
export type BudgetType = 'DAILY' | 'LIFETIME';
export type CampaignPlanStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'LAUNCHING'
  | 'LAUNCHED'
  | 'FAILED'
  | 'ARCHIVED';

export type AudienceGender = 'MALE' | 'FEMALE' | 'ALL';
export type CreativeFormat = 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'COLLECTION';

export type RiskSeverity = 'WARNING' | 'BLOCKER';
export type ConfidenceLabel = 'LOW' | 'MEDIUM' | 'HIGH';
export type ConfidenceFactorKey =
  | 'PIXEL_AVAILABILITY'
  | 'AUDIENCE_CLARITY'
  | 'BUDGET_SUFFICIENCY';

export type LaunchStatus = 'PENDING' | 'CREATING' | 'CREATED' | 'FAILED' | 'SKIPPED';

// ─── Wizard input ─────────────────────────────────────────────────────────────

export interface GoalDetail {
  targetCpa?: number;
  targetRoas?: number;
  targetLeadsPerMonth?: number;
  targetInstallsPerMonth?: number;
  targetReach?: number;
  targetClicks?: number;
  targetEngagements?: number;
  notes?: string;
}

export interface Geography {
  countries: string[];
  cities?: string[];
  radiusKm?: number;
}

export interface AudienceHints {
  ageMin: number;
  ageMax: number;
  genders: AudienceGender[];
  languages?: string[];
  interestTags?: string[];
}

export interface BudgetInput {
  totalBudget: number;
  budgetType: BudgetType;
  currency: string;
}

export interface TimelineInput {
  startDate: string;
  endDate?: string;
}

export interface PlatformSelection {
  platforms: Platform[];
  adAccountIds: Record<string, string>;
}

export interface CreativeBrief {
  formats: CreativeFormat[];
  assetRefs?: string[];
  headline?: string;
  description?: string;
  cta?: string;
  landingUrl?: string;
  pixelInstalled?: boolean;
}

export interface WizardInput {
  name: string;
  goal: CampaignGoal;
  goalDetail: GoalDetail;
  geography: Geography;
  audience: AudienceHints;
  budget: BudgetInput;
  timeline: TimelineInput;
  platformSelection: PlatformSelection;
  creativeBrief: CreativeBrief;
}

// ─── Plan response ───────────────────────────────────────────────────────────

export interface ConfidenceFactor {
  key: ConfidenceFactorKey;
  score: number;
  note: string;
}

export interface Confidence {
  score: number;
  label: ConfidenceLabel;
  factors: ConfidenceFactor[];
}

export interface StrategicSummary {
  en: string;
  ar?: string | null;
  confidence: Confidence;
}

export interface RiskFinding {
  code: string;
  severity: RiskSeverity;
  message: string;
  platform?: string;
  context?: Record<string, unknown>;
}

export interface PlanItem {
  id: string;
  planId: string;
  platform: Platform;
  adAccountId: string;
  objective: string;
  dailyBudget: number;
  isCbo: boolean;
  biddingStrategy: string;
  bidTarget: number | null;
  audience: Record<string, unknown>;
  creativeRef: Record<string, unknown>;
  launchStatus: LaunchStatus;
  externalCampaignId: string | null;
  externalAdsetIds: string[] | null;
  errorMessage: string | null;
  launchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanResponse {
  id: string;
  orgId: string;
  createdById: string;
  status: CampaignPlanStatus;
  goal: CampaignGoal;
  funnelStage: FunnelStage;
  totalBudget: number;
  budgetType: BudgetType;
  currency: string;
  startDate: string;
  endDate: string | null;
  geography: Record<string, unknown>;
  audienceHints: Record<string, unknown> | null;
  creativeBrief: Record<string, unknown>;
  wizardAnswers: Record<string, unknown>;
  reasoning: Record<string, unknown>;
  summary: StrategicSummary;
  risks: RiskFinding[];
  warningsAcknowledged: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  launchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PlanItem[];
}

// ─── Launch result ───────────────────────────────────────────────────────────

export interface LaunchResultItem {
  itemId: string;
  platform: Platform;
  launchStatus: LaunchStatus;
  externalCampaignId: string | null;
  externalAdsetIds: string[] | null;
  externalCreativeId: string | null;
  externalAdId: string | null;
  errorMessage: string | null;
  launchedAt: string | null;
}

export interface LaunchProgressSummary {
  progressPct: number;
  successRate: number;
  durationMs: number;
  message: string;
}

export interface LaunchResult {
  planId: string;
  planStatus: CampaignPlanStatus;
  launchedAt: string | null;
  totalItems: number;
  createdCount: number;
  failedCount: number;
  skippedCount: number;
  summary: LaunchProgressSummary;
  items: LaunchResultItem[];
}

// Plan name is not stored on the entity itself in Phase 1 — wizardAnswers carries it.
// Convenience accessor used by the UI.
export function getPlanName(plan: PlanResponse): string {
  const answers = plan.wizardAnswers;
  if (answers && typeof answers === 'object' && 'name' in answers) {
    const v = (answers as { name?: unknown }).name;
    if (typeof v === 'string') return v;
  }
  return plan.id.slice(0, 8);
}
