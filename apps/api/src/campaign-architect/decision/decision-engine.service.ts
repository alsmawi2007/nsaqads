import { Injectable } from '@nestjs/common';
import {
  BudgetType,
  CampaignGoal,
  FunnelStage,
  Platform,
} from '@prisma/client';
import {
  BiddingStrategy,
  NormalizedAudience,
} from '../../providers/interfaces/ad-provider.interface';
import {
  AudienceGender,
  GoalDetailDto,
  WizardInputDto,
} from '../dto/wizard-input.dto';
import {
  BudgetAllocationEntry,
  CreativeRef,
  DecisionEngineContext,
  PlanDraft,
  PlanItemDraft,
  ReasoningTrace,
} from '../types';

@Injectable()
export class DecisionEngineService {
  private static readonly SUPPORTED_PLATFORMS: Platform[] = [
    Platform.META,
    Platform.GOOGLE_ADS,
  ];

  private static readonly GOAL_TO_FUNNEL: Record<CampaignGoal, FunnelStage> = {
    AWARENESS: FunnelStage.TOFU,
    TRAFFIC: FunnelStage.TOFU,
    ENGAGEMENT: FunnelStage.MOFU,
    LEADS: FunnelStage.MOFU,
    APP_INSTALLS: FunnelStage.MOFU,
    SALES: FunnelStage.BOFU,
  };

  private static readonly OBJECTIVE_MAP: Record<
    Platform,
    Record<CampaignGoal, string>
  > = {
    META: {
      AWARENESS: 'REACH',
      TRAFFIC: 'LINK_CLICKS',
      ENGAGEMENT: 'POST_ENGAGEMENT',
      LEADS: 'LEAD_GENERATION',
      SALES: 'CONVERSIONS',
      APP_INSTALLS: 'APP_INSTALLS',
    },
    GOOGLE_ADS: {
      AWARENESS: 'DISPLAY_REACH',
      TRAFFIC: 'SEARCH_CLICKS',
      ENGAGEMENT: 'VIDEO_VIEWS',
      LEADS: 'LEAD_GENERATION',
      SALES: 'CONVERSIONS',
      APP_INSTALLS: 'APP_PROMOTION',
    },
    TIKTOK: {
      AWARENESS: 'REACH',
      TRAFFIC: 'TRAFFIC',
      ENGAGEMENT: 'ENGAGEMENT',
      LEADS: 'LEAD_GENERATION',
      SALES: 'CONVERSIONS',
      APP_INSTALLS: 'APP_PROMOTION',
    },
    SNAPCHAT: {
      AWARENESS: 'AWARENESS',
      TRAFFIC: 'WEB_VIEW',
      ENGAGEMENT: 'ENGAGEMENT',
      LEADS: 'LEAD_GENERATION',
      SALES: 'WEB_CONVERSION',
      APP_INSTALLS: 'APP_INSTALL',
    },
    // X / Twitter is a config-only platform until a TwitterProvider lands.
    // SUPPORTED_PLATFORMS does not include TWITTER, so this entry is never
    // reached at runtime — present only to satisfy the exhaustive Record type.
    TWITTER: {
      AWARENESS: 'REACH',
      TRAFFIC: 'WEBSITE_CLICKS',
      ENGAGEMENT: 'ENGAGEMENTS',
      LEADS: 'LEAD_GENERATION',
      SALES: 'WEBSITE_CONVERSIONS',
      APP_INSTALLS: 'APP_INSTALLS',
    },
  };

  private static readonly BUDGET_SHARES: Record<
    CampaignGoal,
    Partial<Record<Platform, number>>
  > = {
    AWARENESS: { META: 0.65, GOOGLE_ADS: 0.35 },
    TRAFFIC: { META: 0.45, GOOGLE_ADS: 0.55 },
    ENGAGEMENT: { META: 0.7, GOOGLE_ADS: 0.3 },
    LEADS: { META: 0.6, GOOGLE_ADS: 0.4 },
    SALES: { META: 0.55, GOOGLE_ADS: 0.45 },
    APP_INSTALLS: { META: 0.5, GOOGLE_ADS: 0.5 },
  };

  build(ctx: DecisionEngineContext): PlanDraft {
    const { input } = ctx;
    const funnelStage = DecisionEngineService.GOAL_TO_FUNNEL[input.goal];

    const requested = [...input.platformSelection.platforms];
    const accepted = requested.filter((p) =>
      DecisionEngineService.SUPPORTED_PLATFORMS.includes(p),
    );
    const rejected = requested.filter(
      (p) => !DecisionEngineService.SUPPORTED_PLATFORMS.includes(p),
    );

    const durationDays = this.computeDurationDays(
      input.timeline.startDate,
      input.timeline.endDate ?? null,
    );

    const allocation = this.allocateBudget(accepted, input, durationDays);

    const items: PlanItemDraft[] = accepted.map((platform) => {
      const entry = allocation.find((e) => e.platform === platform)!;
      return this.buildItem(platform, input, entry.dailyBudget);
    });

    const reasoning: ReasoningTrace = {
      goalToFunnel: { goal: input.goal, funnelStage },
      supportedPlatforms: { requested, accepted, rejected },
      platformObjectives: items.map((i) => ({
        platform: i.platform,
        objective: i.objective,
        rationale: `Maps goal ${input.goal} to objective ${i.objective} on ${i.platform}.`,
      })),
      budgetAllocation: {
        durationDays,
        currency: input.budget.currency,
        budgetType: input.budget.budgetType,
        totalBudget: input.budget.totalBudget,
        perPlatform: allocation,
      },
      biddingStrategies: items.map((i) => ({
        platform: i.platform,
        strategy: i.biddingStrategy,
        bidTarget: i.bidTarget,
        rationale: this.explainBiddingStrategy(
          input.goal,
          i.biddingStrategy,
          i.bidTarget,
        ),
      })),
      cboDecisions: items.map((i) => ({
        platform: i.platform,
        isCbo: i.isCbo,
        rationale: i.isCbo
          ? 'Meta CBO is the MVP default: campaign-level budget with platform-driven allocation across ad sets.'
          : 'Google Ads uses ad-set-level budgeting; CBO is disabled for this platform.',
      })),
      audienceDefaults: {
        rationale:
          'Audience inherits wizard hints (age, gender, languages, interest tags) combined with plan geography.',
      },
    };

    const creativeBrief = this.buildCreativeRef(input);

    return {
      goal: input.goal,
      funnelStage,
      totalBudget: input.budget.totalBudget,
      budgetType: input.budget.budgetType,
      currency: input.budget.currency,
      startDate: input.timeline.startDate,
      endDate: input.timeline.endDate ?? null,
      durationDays,
      geography: {
        countries: input.geography.countries,
        cities: input.geography.cities ?? null,
        radiusKm: input.geography.radiusKm ?? null,
      },
      audienceHints: {
        ageMin: input.audience.ageMin,
        ageMax: input.audience.ageMax,
        genders: input.audience.genders,
        languages: input.audience.languages ?? null,
        interestTags: input.audience.interestTags ?? null,
      },
      creativeBrief,
      wizardAnswers: input,
      reasoning,
      items,
    };
  }

  private buildItem(
    platform: Platform,
    input: WizardInputDto,
    dailyBudget: number,
  ): PlanItemDraft {
    const bidding = this.chooseBiddingStrategy(input.goal, input.goalDetail);
    return {
      platform,
      adAccountId: input.platformSelection.adAccountIds[platform],
      objective: this.resolveObjective(platform, input.goal),
      dailyBudget,
      isCbo: this.chooseCbo(platform),
      biddingStrategy: bidding.strategy,
      bidTarget: bidding.bidTarget,
      audience: this.buildAudience(input),
      creativeRef: this.buildCreativeRef(input),
    };
  }

  private allocateBudget(
    platforms: Platform[],
    input: WizardInputDto,
    durationDays: number | null,
  ): BudgetAllocationEntry[] {
    if (platforms.length === 0) return [];

    const rawShares: Record<string, number> = {};
    let totalRaw = 0;
    for (const p of platforms) {
      const raw =
        DecisionEngineService.BUDGET_SHARES[input.goal][p] ??
        1 / platforms.length;
      rawShares[p] = raw;
      totalRaw += raw;
    }

    const budgetType = input.budget.budgetType;
    const totalBudget = input.budget.totalBudget;
    const effectiveDays =
      budgetType === BudgetType.LIFETIME ? durationDays ?? 30 : 1;

    return platforms.map((p) => {
      const share = rawShares[p] / totalRaw;
      const allocated =
        budgetType === BudgetType.DAILY
          ? totalBudget * share
          : (totalBudget * share) / effectiveDays;
      return {
        platform: p,
        sharePct: Math.round(share * 10000) / 100,
        dailyBudget: round2(allocated),
        rationale:
          budgetType === BudgetType.DAILY
            ? `Allocated ${(share * 100).toFixed(1)}% of daily total to ${p} for goal ${input.goal}.`
            : `Allocated ${(share * 100).toFixed(1)}% of lifetime budget to ${p} over ${effectiveDays} days for goal ${input.goal}.`,
      };
    });
  }

  private chooseBiddingStrategy(
    goal: CampaignGoal,
    detail: GoalDetailDto,
  ): { strategy: BiddingStrategy; bidTarget: number | null } {
    if (goal === CampaignGoal.SALES) {
      if (detail.targetRoas != null && detail.targetRoas > 0) {
        return {
          strategy: BiddingStrategy.TARGET_ROAS,
          bidTarget: detail.targetRoas,
        };
      }
      if (detail.targetCpa != null && detail.targetCpa > 0) {
        return {
          strategy: BiddingStrategy.TARGET_CPA,
          bidTarget: detail.targetCpa,
        };
      }
      return { strategy: BiddingStrategy.LOWEST_COST, bidTarget: null };
    }

    if (goal === CampaignGoal.LEADS || goal === CampaignGoal.APP_INSTALLS) {
      if (detail.targetCpa != null && detail.targetCpa > 0) {
        return {
          strategy: BiddingStrategy.TARGET_CPA,
          bidTarget: detail.targetCpa,
        };
      }
      return { strategy: BiddingStrategy.LOWEST_COST, bidTarget: null };
    }

    return { strategy: BiddingStrategy.LOWEST_COST, bidTarget: null };
  }

  private chooseCbo(platform: Platform): boolean {
    return platform === Platform.META;
  }

  private resolveObjective(platform: Platform, goal: CampaignGoal): string {
    return (
      DecisionEngineService.OBJECTIVE_MAP[platform]?.[goal] ?? 'CONVERSIONS'
    );
  }

  private buildAudience(input: WizardInputDto): NormalizedAudience {
    return {
      countries: input.geography.countries,
      cities: input.geography.cities ?? null,
      radiusKm: input.geography.radiusKm ?? null,
      ageMin: input.audience.ageMin,
      ageMax: input.audience.ageMax,
      genders: input.audience.genders as unknown as (
        | 'MALE'
        | 'FEMALE'
        | 'ALL'
      )[],
      languages: input.audience.languages ?? null,
      interestTags: input.audience.interestTags ?? null,
    };
  }

  private buildCreativeRef(input: WizardInputDto): CreativeRef {
    const brief = input.creativeBrief;
    return {
      formats: brief.formats,
      assetRefs: brief.assetRefs ?? [],
      headline: brief.headline ?? null,
      description: brief.description ?? null,
      cta: brief.cta ?? null,
      landingUrl: brief.landingUrl ?? null,
      pixelInstalled: brief.pixelInstalled ?? null,
    };
  }

  private computeDurationDays(
    startDate: string,
    endDate: string | null,
  ): number | null {
    if (!endDate) return null;
    const start = Date.parse(startDate);
    const end = Date.parse(endDate);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    return Math.max(1, Math.round((end - start) / 86_400_000));
  }

  private explainBiddingStrategy(
    goal: CampaignGoal,
    strategy: BiddingStrategy,
    bidTarget: number | null,
  ): string {
    if (strategy === BiddingStrategy.TARGET_ROAS)
      return `SALES goal with targetRoas=${bidTarget} → TARGET_ROAS.`;
    if (strategy === BiddingStrategy.TARGET_CPA)
      return `Goal ${goal} with targetCpa=${bidTarget} → TARGET_CPA.`;
    return `Goal ${goal} with no bid target → LOWEST_COST (platform optimizes delivery).`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export enum so tests can reference without deep imports
export { AudienceGender };
