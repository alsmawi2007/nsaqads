import { Injectable, Logger } from '@nestjs/common';
import {
  CampaignGoal,
  FunnelStage,
  Platform,
  Prisma,
  ScoringSkippedReason,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HllFeatureFlagService } from '../feature-flag.service';
import { MultiplierService } from './multiplier.service';
import { MultiplierResult } from '../types';

export interface ScorePlatformInput {
  orgId: string;
  campaignPlanId?: string | null;
  planSynthesisRunId: string;
  platform: Platform;
  goal: CampaignGoal;
  funnelStage: FunnelStage;
  baseFitness: number;
  now?: Date;
}

export interface ScorePlatformOutput {
  finalScore: number;
  multiplier: number;
  hllApplied: boolean;
  skippedReason: ScoringSkippedReason | null;
  result: MultiplierResult;
}

@Injectable()
export class HllScoringService {
  private readonly logger = new Logger(HllScoringService.name);

  constructor(
    private prisma: PrismaService,
    private flag: HllFeatureFlagService,
    private multiplier: MultiplierService,
  ) {}

  // Computes final platform score with HLL multiplier applied.
  // Always returns a value — never throws into the DecisionEngine path.
  // Always writes a PlatformScoringDecision row when decision logging is on,
  // even when HLL is disabled or the org is not in the canary, to allow
  // distribution monitoring during canary ramp-up.
  async scorePlatform(input: ScorePlatformInput): Promise<ScorePlatformOutput> {
    const now = input.now ?? new Date();

    let hllApplied = false;
    let skippedReason: ScoringSkippedReason | null = null;
    let result: MultiplierResult = {
      multiplier: 1,
      clamped: false,
      contributions: [],
      skippedReason: null,
      confidenceSummary: { high: 0, medium: 0, low: 0, warmStart: 0 },
    };

    const enabled = await this.flag.isGloballyEnabled();
    if (!enabled) {
      skippedReason = 'HLL_DISABLED';
    } else {
      const inCanary = await this.flag.isOrgInCanary(input.orgId);
      if (!inCanary) {
        skippedReason = 'ORG_NOT_CANARY';
      } else {
        try {
          result = await this.multiplier.compute({
            orgId: input.orgId,
            platform: input.platform,
            goal: input.goal,
            funnelStage: input.funnelStage,
            now,
          });
          if (result.skippedReason !== null) {
            skippedReason = result.skippedReason;
          } else {
            hllApplied = true;
          }
        } catch (err: unknown) {
          this.logger.error(
            `HLL scoring threw for org ${input.orgId} platform ${input.platform}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          skippedReason = 'BAD_VALUE';
        }
      }
    }

    const finalScore = hllApplied ? input.baseFitness * result.multiplier : input.baseFitness;

    if (await this.flag.isDecisionLoggingEnabled()) {
      await this.logDecision(input, finalScore, hllApplied, skippedReason, result, now).catch(
        (err: unknown) => {
          this.logger.warn(
            `Failed to log scoring decision: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    }

    return { finalScore, multiplier: result.multiplier, hllApplied, skippedReason, result };
  }

  private async logDecision(
    input: ScorePlatformInput,
    finalScore: number,
    hllApplied: boolean,
    skippedReason: ScoringSkippedReason | null,
    result: MultiplierResult,
    now: Date,
  ): Promise<void> {
    await this.prisma.platformScoringDecision.create({
      data: {
        orgId: input.orgId,
        campaignPlanId: input.campaignPlanId ?? null,
        planSynthesisRunId: input.planSynthesisRunId,
        platform: input.platform,
        goal: input.goal,
        funnelStage: input.funnelStage,
        baseFitness: new Prisma.Decimal(input.baseFitness.toFixed(6)),
        multiplier: hllApplied ? new Prisma.Decimal(result.multiplier.toFixed(6)) : null,
        multiplierClamped: result.clamped,
        finalScore: new Prisma.Decimal(finalScore.toFixed(6)),
        hllApplied,
        skippedReason,
        featuresUsed: result.contributions as unknown as Prisma.InputJsonValue,
        confidenceSummary: result.confidenceSummary as unknown as Prisma.InputJsonValue,
        explanation: this.buildExplanation(hllApplied, skippedReason, result) as unknown as Prisma.InputJsonValue,
        decidedAt: now,
      },
    });
  }

  private buildExplanation(
    hllApplied: boolean,
    skippedReason: ScoringSkippedReason | null,
    result: MultiplierResult,
  ): { en: string; ar: null } {
    if (!hllApplied) {
      const reason = skippedReason ?? 'UNKNOWN';
      return {
        en: `HLL multiplier not applied (${reason}). Used base platform fitness as final score.`,
        ar: null,
      };
    }
    const features = result.contributions
      .map((c) => `${c.featureName}@${c.windowDays}d=${c.value.toFixed(2)} (conf=${c.confidence})`)
      .join(', ');
    const clampNote = result.clamped ? ' (clamped to safety bounds)' : '';
    return {
      en: `HLL multiplier ${result.multiplier.toFixed(2)}× applied${clampNote}. Features used: ${features || 'none'}.`,
      ar: null,
    };
  }
}
