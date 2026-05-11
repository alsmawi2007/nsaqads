import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CampaignGoal, FunnelStage, Platform } from '@prisma/client';
import { PlanDraft, PlanItemDraft } from '../../campaign-architect/types';
import { HllScoringService } from './scoring.service';

const PLATFORM_FUNNEL: Record<Platform, FunnelStage> = {
  META: 'TOFU',
  TIKTOK: 'TOFU',
  GOOGLE_ADS: 'BOFU',
  SNAPCHAT: 'TOFU',
  // X / Twitter is awareness/engagement-driven; classify with the other
  // top-of-funnel social platforms.
  TWITTER: 'TOFU',
};

const BASE_FITNESS = 1.0;

@Injectable()
export class HllPlanAdjusterService {
  private readonly logger = new Logger(HllPlanAdjusterService.name);

  constructor(private scoring: HllScoringService) {}

  // Re-weights the budget allocation across plan items by multiplying each
  // item's daily budget by its HLL multiplier, then renormalizing back to
  // the original total. Attaches an English explanation per item.
  // Idempotent and preserves the input draft when HLL is disabled.
  async adjust(orgId: string, draft: PlanDraft, planId: string | null = null): Promise<PlanDraft> {
    if (draft.items.length === 0) return draft;

    const planSynthesisRunId = randomUUID();
    const baseTotal = draft.items.reduce((sum, item) => sum + item.dailyBudget, 0);
    if (baseTotal <= 0) return draft;

    const adjusted: PlanItemDraft[] = [];
    const multipliers: number[] = [];

    for (const item of draft.items) {
      const score = await this.scoring.scorePlatform({
        orgId,
        campaignPlanId: planId,
        planSynthesisRunId,
        platform: item.platform,
        goal: draft.goal,
        funnelStage: PLATFORM_FUNNEL[item.platform] ?? draft.funnelStage,
        baseFitness: BASE_FITNESS,
      });
      multipliers.push(score.hllApplied ? score.multiplier : 1.0);
      adjusted.push({
        ...item,
        historyExplanation: this.explain(score.hllApplied, score.multiplier, score.skippedReason),
      });
    }

    // Renormalize budgets so sum stays equal to baseTotal.
    const weightedTotal = draft.items.reduce(
      (sum, item, idx) => sum + item.dailyBudget * multipliers[idx],
      0,
    );

    if (weightedTotal <= 0) return { ...draft, items: adjusted };

    const final = adjusted.map((item, idx) => ({
      ...item,
      dailyBudget: round2((item.dailyBudget * multipliers[idx] * baseTotal) / weightedTotal),
    }));

    return { ...draft, items: final };
  }

  private explain(
    hllApplied: boolean,
    multiplier: number,
    skippedReason: string | null,
  ): { en: string; ar: null } {
    if (!hllApplied) {
      return {
        en: `No history-based adjustment applied (${skippedReason ?? 'no signal'}). Budget kept at base allocation.`,
        ar: null,
      };
    }
    if (multiplier > 1.05) {
      return {
        en: `Historical performance suggests boosting this platform — applied ${multiplier.toFixed(2)}× multiplier.`,
        ar: null,
      };
    }
    if (multiplier < 0.95) {
      return {
        en: `Historical performance suggests pulling back on this platform — applied ${multiplier.toFixed(2)}× multiplier.`,
        ar: null,
      };
    }
    return {
      en: `Historical performance is neutral for this platform — applied ${multiplier.toFixed(2)}× multiplier.`,
      ar: null,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// CampaignGoal re-export so the type stays callable from outside.
export type { CampaignGoal };
