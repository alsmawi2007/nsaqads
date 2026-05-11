import { Injectable } from '@nestjs/common';
import { BudgetType, CampaignGoal, Platform } from '@prisma/client';
import {
  ConfidenceDto,
  ConfidenceFactorDto,
  ConfidenceFactorKey,
  ConfidenceLabel,
  StrategicSummaryDto,
} from '../dto/strategic-summary.dto';
import { PlanDraft } from '../types';

@Injectable()
export class StrategicSummaryService {
  private static readonly CONVERSION_GOALS: CampaignGoal[] = [
    CampaignGoal.SALES,
    CampaignGoal.LEADS,
    CampaignGoal.APP_INSTALLS,
  ];

  private static readonly PLATFORM_MIN_DAILY_USD: Record<Platform, number> = {
    META: 1,
    GOOGLE_ADS: 5,
    TIKTOK: 20,
    SNAPCHAT: 20,
    TWITTER: 5,
  };

  private static readonly HEALTHY_MULTIPLIER = 5;

  private static readonly FACTOR_WEIGHTS: Record<ConfidenceFactorKey, number> =
    {
      PIXEL_AVAILABILITY: 0.3,
      AUDIENCE_CLARITY: 0.3,
      BUDGET_SUFFICIENCY: 0.4,
    };

  build(draft: PlanDraft): StrategicSummaryDto {
    const confidence = this.computeConfidence(draft);
    return {
      en: this.buildEnglishNarrative(draft, confidence),
      ar: null,
      confidence,
    };
  }

  private computeConfidence(draft: PlanDraft): ConfidenceDto {
    const factors: ConfidenceFactorDto[] = [
      this.pixelAvailabilityFactor(draft),
      this.audienceClarityFactor(draft),
      this.budgetSufficiencyFactor(draft),
    ];

    const weighted = factors.reduce(
      (sum, f) =>
        sum + f.score * StrategicSummaryService.FACTOR_WEIGHTS[f.key],
      0,
    );
    const score = Math.round(weighted);

    let label: ConfidenceLabel;
    if (score >= 75) label = ConfidenceLabel.HIGH;
    else if (score >= 50) label = ConfidenceLabel.MEDIUM;
    else label = ConfidenceLabel.LOW;

    return { score, label, factors };
  }

  private pixelAvailabilityFactor(draft: PlanDraft): ConfidenceFactorDto {
    const requiresPixel =
      StrategicSummaryService.CONVERSION_GOALS.includes(draft.goal);
    const pixel = draft.creativeBrief.pixelInstalled;

    if (!requiresPixel) {
      return {
        key: ConfidenceFactorKey.PIXEL_AVAILABILITY,
        score: 100,
        note: `Goal ${draft.goal} does not depend on conversion tracking.`,
      };
    }
    if (pixel === true) {
      return {
        key: ConfidenceFactorKey.PIXEL_AVAILABILITY,
        score: 100,
        note: 'Conversion tracking confirmed on the landing domain.',
      };
    }
    if (pixel === false) {
      return {
        key: ConfidenceFactorKey.PIXEL_AVAILABILITY,
        score: 15,
        note: `Goal ${draft.goal} needs a pixel / conversion API; none detected.`,
      };
    }
    return {
      key: ConfidenceFactorKey.PIXEL_AVAILABILITY,
      score: 40,
      note: `Pixel status unknown for goal ${draft.goal} — verify before launch.`,
    };
  }

  private audienceClarityFactor(draft: PlanDraft): ConfidenceFactorDto {
    const a = draft.audienceHints;
    const ageSpan = a.ageMax - a.ageMin;
    const interestCount = a.interestTags?.length ?? 0;
    const hasLanguages = (a.languages?.length ?? 0) > 0;
    const hasCities = (draft.geography.cities?.length ?? 0) > 0;

    let score = 40;
    if (interestCount >= 3) score += 25;
    else if (interestCount >= 1) score += 12;

    if (ageSpan <= 15) score += 20;
    else if (ageSpan <= 25) score += 10;

    if (hasLanguages) score += 8;
    if (hasCities) score += 7;

    score = Math.min(100, score);

    const parts: string[] = [];
    parts.push(
      interestCount > 0
        ? `${interestCount} interest tag${interestCount === 1 ? '' : 's'}`
        : 'no interest tags',
    );
    parts.push(`age span ${ageSpan}`);
    if (hasCities) parts.push(`${draft.geography.cities!.length} city target(s)`);
    if (hasLanguages) parts.push('languages set');

    return {
      key: ConfidenceFactorKey.AUDIENCE_CLARITY,
      score,
      note: `Audience: ${parts.join(', ')}.`,
    };
  }

  private budgetSufficiencyFactor(draft: PlanDraft): ConfidenceFactorDto {
    if (draft.items.length === 0) {
      return {
        key: ConfidenceFactorKey.BUDGET_SUFFICIENCY,
        score: 0,
        note: 'No plan items to evaluate.',
      };
    }

    let total = 0;
    const perPlatform: Array<{ platform: Platform; score: number }> = [];
    for (const item of draft.items) {
      const min = StrategicSummaryService.PLATFORM_MIN_DAILY_USD[item.platform];
      const healthy = min * StrategicSummaryService.HEALTHY_MULTIPLIER;
      let itemScore: number;
      if (item.dailyBudget >= healthy) itemScore = 100;
      else if (item.dailyBudget >= min) itemScore = 60;
      else itemScore = 10;
      total += itemScore;
      perPlatform.push({ platform: item.platform, score: itemScore });
    }
    const score = Math.round(total / draft.items.length);

    const lowest = perPlatform.reduce((a, b) => (a.score < b.score ? a : b));
    const note =
      score >= 90
        ? 'Daily budget is comfortably above platform minimums on every platform.'
        : score >= 60
          ? `Daily budget meets platform minimums, but ${lowest.platform} is below the recommended multiple.`
          : `Daily budget is below platform minimums on ${lowest.platform}; platform delivery will be unstable.`;

    return {
      key: ConfidenceFactorKey.BUDGET_SUFFICIENCY,
      score,
      note,
    };
  }

  private buildEnglishNarrative(
    draft: PlanDraft,
    confidence: ConfidenceDto,
  ): string {
    const platformList = draft.items.map((i) => i.platform).join(' and ') ||
      'no platforms';
    const durationClause =
      draft.durationDays !== null
        ? `${draft.durationDays} day${draft.durationDays === 1 ? '' : 's'}`
        : 'an open-ended window';
    const budgetClause =
      draft.budgetType === BudgetType.DAILY
        ? `daily total of ${draft.totalBudget} ${draft.currency}`
        : `lifetime budget of ${draft.totalBudget} ${draft.currency}`;

    const allocationParts = draft.reasoning.budgetAllocation.perPlatform.map(
      (p) => `${p.sharePct}% ${p.platform}`,
    );
    const allocationClause =
      allocationParts.length > 0
        ? `Allocation: ${allocationParts.join(', ')}.`
        : '';

    const primary = draft.items[0];
    const biddingClause = primary
      ? `Primary bidding: ${primary.biddingStrategy}${
          primary.bidTarget !== null ? ` (target ${primary.bidTarget})` : ''
        }.`
      : '';

    const a = draft.audienceHints;
    const gendersLabel = a.genders.join('/');
    const countriesLabel = draft.geography.countries.join(', ');
    const audienceClause = `Audience: ages ${a.ageMin}–${a.ageMax}, ${gendersLabel}, ${countriesLabel}.`;

    const confidenceClause = `Confidence: ${confidence.label} (${confidence.score}/100).`;

    return [
      `Strategy: ${draft.goal} plan at ${draft.funnelStage} stage across ${platformList} over ${durationClause} (${budgetClause}).`,
      allocationClause,
      biddingClause,
      audienceClause,
      confidenceClause,
    ]
      .filter((s) => s.length > 0)
      .join(' ');
  }
}
