import { Injectable } from '@nestjs/common';
import { BudgetType, CampaignGoal, Platform } from '@prisma/client';
import {
  RiskCode,
  RiskFindingDto,
  RiskSeverity,
} from '../dto/risk-finding.dto';
import { DecisionEngineContext, PlanDraft } from '../types';

@Injectable()
export class RiskCheckService {
  private static readonly PLATFORM_MIN_DAILY_USD: Record<Platform, number> = {
    META: 1,
    GOOGLE_ADS: 5,
    TIKTOK: 20,
    SNAPCHAT: 20,
    // X / Twitter does not enforce a minimum daily budget on its end, but
    // setting an analogous floor keeps the LOW_DAILY_BUDGET warning useful.
    TWITTER: 5,
  };

  // Daily budget below this multiple of the platform minimum = LOW_DAILY_BUDGET warning
  private static readonly LOW_BUDGET_MULTIPLIER = 3;

  private static readonly CONVERSION_GOALS: CampaignGoal[] = [
    CampaignGoal.SALES,
    CampaignGoal.LEADS,
    CampaignGoal.APP_INSTALLS,
  ];

  private static readonly SHORT_CAMPAIGN_DAYS = 7;

  evaluate(
    draft: PlanDraft,
    ctx: DecisionEngineContext,
  ): RiskFindingDto[] {
    const findings: RiskFindingDto[] = [];

    findings.push(...this.checkPlatformCoverage(draft));
    if (findings.some((f) => f.code === RiskCode.UNSUPPORTED_PLATFORM_FOR_GOAL)) {
      // No supported platforms remain — no point running item-level checks
      return findings;
    }

    findings.push(...this.checkBudgetFloors(draft));
    findings.push(...this.checkAdAccounts(draft, ctx));
    findings.push(...this.checkCurrencyAlignment(draft, ctx));
    findings.push(...this.checkLifetimeBudgetEndDate(draft));
    findings.push(...this.checkSinglePlatformConcentration(draft));
    findings.push(...this.checkPixelForConversionGoals(draft));
    findings.push(...this.checkShortCampaignWindow(draft));
    findings.push(...this.checkWeakAudienceDefinition(draft));
    findings.push(...this.checkWeekendStart(draft));
    findings.push(...this.checkCreativeAssets(draft));
    findings.push(...this.checkHeadline(draft));

    return RiskCheckService.sortBySeverity(findings);
  }

  private static sortBySeverity(findings: RiskFindingDto[]): RiskFindingDto[] {
    const rank: Record<RiskSeverity, number> = {
      [RiskSeverity.BLOCKER]: 0,
      [RiskSeverity.WARNING]: 1,
    };
    return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  private checkPlatformCoverage(draft: PlanDraft): RiskFindingDto[] {
    if (draft.items.length === 0) {
      return [
        {
          code: RiskCode.UNSUPPORTED_PLATFORM_FOR_GOAL,
          severity: RiskSeverity.BLOCKER,
          message:
            'No supported platforms remain after filtering. Phase 1 supports META and GOOGLE_ADS only.',
          context: {
            requested: draft.reasoning.supportedPlatforms.requested,
            rejected: draft.reasoning.supportedPlatforms.rejected,
          },
        },
      ];
    }
    if (draft.reasoning.supportedPlatforms.rejected.length > 0) {
      // Surface a WARNING — plan still launches on supported platforms
      return [
        {
          code: RiskCode.UNSUPPORTED_PLATFORM_FOR_GOAL,
          severity: RiskSeverity.WARNING,
          message: `Dropped unsupported platforms: ${draft.reasoning.supportedPlatforms.rejected.join(', ')}. Phase 1 supports META and GOOGLE_ADS only.`,
          context: {
            rejected: draft.reasoning.supportedPlatforms.rejected,
          },
        },
      ];
    }
    return [];
  }

  private checkBudgetFloors(draft: PlanDraft): RiskFindingDto[] {
    const findings: RiskFindingDto[] = [];
    const belowFloor = draft.items.filter(
      (i) =>
        i.dailyBudget <
        RiskCheckService.PLATFORM_MIN_DAILY_USD[i.platform],
    );

    if (belowFloor.length > 0 && belowFloor.length === draft.items.length) {
      findings.push({
        code: RiskCode.BUDGET_BELOW_PLATFORM_MINIMUM,
        severity: RiskSeverity.BLOCKER,
        message:
          'Daily budget is below the platform minimum on every selected platform. Increase the plan budget before launch.',
        context: {
          perPlatform: belowFloor.map((i) => ({
            platform: i.platform,
            dailyBudget: i.dailyBudget,
            minimum: RiskCheckService.PLATFORM_MIN_DAILY_USD[i.platform],
          })),
        },
      });
      return findings;
    }

    for (const item of belowFloor) {
      findings.push({
        code: RiskCode.BUDGET_BELOW_PLATFORM_MINIMUM,
        severity: RiskSeverity.BLOCKER,
        message: `Daily budget (${item.dailyBudget}) for ${item.platform} is below the platform minimum of ${RiskCheckService.PLATFORM_MIN_DAILY_USD[item.platform]}.`,
        platform: item.platform,
        context: {
          dailyBudget: item.dailyBudget,
          minimum: RiskCheckService.PLATFORM_MIN_DAILY_USD[item.platform],
        },
      });
    }

    for (const item of draft.items) {
      const min = RiskCheckService.PLATFORM_MIN_DAILY_USD[item.platform];
      const low = min * RiskCheckService.LOW_BUDGET_MULTIPLIER;
      if (item.dailyBudget >= min && item.dailyBudget < low) {
        findings.push({
          code: RiskCode.LOW_DAILY_BUDGET,
          severity: RiskSeverity.WARNING,
          message: `Daily budget on ${item.platform} (${item.dailyBudget}) is tight — platform algorithms typically need ≥${low} to exit learning.`,
          platform: item.platform,
          context: {
            dailyBudget: item.dailyBudget,
            recommendedMinimum: low,
          },
        });
      }
    }

    return findings;
  }

  private checkAdAccounts(
    draft: PlanDraft,
    ctx: DecisionEngineContext,
  ): RiskFindingDto[] {
    const findings: RiskFindingDto[] = [];
    for (const item of draft.items) {
      const account = ctx.adAccounts.find((a) => a.id === item.adAccountId);
      if (!account || account.deletedAt !== null) {
        findings.push({
          code: RiskCode.AD_ACCOUNT_NOT_CONNECTED,
          severity: RiskSeverity.BLOCKER,
          message: `No connected ad account found for ${item.platform}. Connect an ad account before launch.`,
          platform: item.platform,
        });
        continue;
      }
      if (account.status !== 'ACTIVE' && account.status !== 'MOCK') {
        findings.push({
          code: RiskCode.AD_ACCOUNT_DISCONNECTED,
          severity: RiskSeverity.BLOCKER,
          message: `Ad account for ${item.platform} is ${account.status}. Reconnect before launch.`,
          platform: item.platform,
          context: { adAccountStatus: account.status },
        });
      }
    }
    return findings;
  }

  private checkCurrencyAlignment(
    draft: PlanDraft,
    ctx: DecisionEngineContext,
  ): RiskFindingDto[] {
    const findings: RiskFindingDto[] = [];
    for (const item of draft.items) {
      const account = ctx.adAccounts.find((a) => a.id === item.adAccountId);
      if (account?.currency && account.currency !== draft.currency) {
        findings.push({
          code: RiskCode.CURRENCY_MISMATCH,
          severity: RiskSeverity.WARNING,
          message: `Plan currency (${draft.currency}) does not match ${item.platform} ad account currency (${account.currency}). The provider will convert — reported spend may differ from plan figures.`,
          platform: item.platform,
          context: {
            planCurrency: draft.currency,
            accountCurrency: account.currency,
          },
        });
      }
    }
    return findings;
  }

  private checkLifetimeBudgetEndDate(draft: PlanDraft): RiskFindingDto[] {
    if (draft.budgetType === BudgetType.LIFETIME && draft.endDate === null) {
      return [
        {
          code: RiskCode.LIFETIME_BUDGET_WITHOUT_END_DATE,
          severity: RiskSeverity.BLOCKER,
          message:
            'LIFETIME budget requires an end date to bound the total spend. Set an end date in the timeline step.',
        },
      ];
    }
    return [];
  }

  private checkSinglePlatformConcentration(
    draft: PlanDraft,
  ): RiskFindingDto[] {
    if (draft.items.length !== 1) return [];
    return [
      {
        code: RiskCode.SINGLE_PLATFORM_CONCENTRATION,
        severity: RiskSeverity.WARNING,
        message: `Plan runs on a single platform (${draft.items[0].platform}). Spreading spend across two platforms typically reduces variance.`,
        platform: draft.items[0].platform,
      },
    ];
  }

  private checkPixelForConversionGoals(draft: PlanDraft): RiskFindingDto[] {
    if (!RiskCheckService.CONVERSION_GOALS.includes(draft.goal)) return [];
    if (draft.creativeBrief.pixelInstalled === true) return [];
    return [
      {
        code: RiskCode.NO_CONVERSION_TRACKING,
        severity: RiskSeverity.WARNING,
        message: `Goal ${draft.goal} depends on conversion tracking. The wizard could not confirm a pixel / conversion API is installed on the landing domain.`,
        context: {
          pixelInstalled: draft.creativeBrief.pixelInstalled,
          landingUrl: draft.creativeBrief.landingUrl,
        },
      },
    ];
  }

  private checkShortCampaignWindow(draft: PlanDraft): RiskFindingDto[] {
    if (
      draft.durationDays !== null &&
      draft.durationDays < RiskCheckService.SHORT_CAMPAIGN_DAYS
    ) {
      return [
        {
          code: RiskCode.SHORT_CAMPAIGN_DURATION,
          severity: RiskSeverity.WARNING,
          message: `Campaign runs for ${draft.durationDays} days — below the ${RiskCheckService.SHORT_CAMPAIGN_DAYS}-day window platforms need to exit learning reliably.`,
          context: {
            durationDays: draft.durationDays,
            recommendedMinimum: RiskCheckService.SHORT_CAMPAIGN_DAYS,
          },
        },
      ];
    }
    return [];
  }

  private checkWeakAudienceDefinition(draft: PlanDraft): RiskFindingDto[] {
    const audience = draft.audienceHints;
    const ageSpan = audience.ageMax - audience.ageMin;
    const noInterests =
      !audience.interestTags || audience.interestTags.length === 0;
    if (noInterests && ageSpan > 30) {
      return [
        {
          code: RiskCode.WEAK_AUDIENCE_DEFINITION,
          severity: RiskSeverity.WARNING,
          message: `Audience is very broad (${ageSpan}-year age span, no interest tags). Narrow either age range or add interests for clearer targeting.`,
          context: { ageSpan, interestTags: audience.interestTags ?? [] },
        },
      ];
    }
    return [];
  }

  private checkWeekendStart(draft: PlanDraft): RiskFindingDto[] {
    const parsed = new Date(draft.startDate + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime())) return [];
    const day = parsed.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
    if (day === 5 || day === 6) {
      return [
        {
          code: RiskCode.WEEKEND_START,
          severity: RiskSeverity.WARNING,
          message: `Campaign starts on ${day === 5 ? 'Friday' : 'Saturday'} (regional weekend). Launching mid-week lets learning accumulate before weekend traffic patterns hit.`,
          context: { startDate: draft.startDate, weekday: day },
        },
      ];
    }
    return [];
  }

  private checkCreativeAssets(draft: PlanDraft): RiskFindingDto[] {
    if (
      draft.creativeBrief.assetRefs &&
      draft.creativeBrief.assetRefs.length > 0
    ) {
      return [];
    }
    return [
      {
        code: RiskCode.MISSING_CREATIVE_ASSETS,
        severity: RiskSeverity.BLOCKER,
        message:
          'Plan has no creative assets attached. Upload at least one asset before approving the plan.',
      },
    ];
  }

  private checkHeadline(draft: PlanDraft): RiskFindingDto[] {
    const headline = draft.creativeBrief.headline?.trim();
    if (headline && headline.length > 0) return [];
    return [
      {
        code: RiskCode.MISSING_HEADLINE,
        severity: RiskSeverity.WARNING,
        message:
          'No headline provided. Platforms fall back to generic copy — a plan-specific headline typically lifts CTR.',
      },
    ];
  }
}
