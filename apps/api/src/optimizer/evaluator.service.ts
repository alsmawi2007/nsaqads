import { Injectable, Logger } from '@nestjs/common';
import { Campaign, AdSet, OptimizerRule, Platform, ActionType, CampaignPhase } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyRecencyWeight } from '../common/utils/recency-weight.util';
import { ProposedAction } from './dto/proposed-action.dto';
import { BudgetRuleHandler } from './rules/budget-rule.handler';
import { BiddingStrategyRuleHandler } from './rules/bidding-strategy-rule.handler';
import { BidLimitRuleHandler } from './rules/bid-limit-rule.handler';
import {
  EvaluationResult,
  IRuleHandler,
  RuleHandlerContext,
  SkipReason,
} from './rules/rule-handler.interface';

type CampaignWithAccount = Campaign & { adAccount: { id: string; currency: string } };

const EMPTY: EvaluationResult = { proposed: [], skipped: [] };

@Injectable()
export class EvaluatorService {
  private readonly logger = new Logger(EvaluatorService.name);
  private readonly registry: Map<ActionType, IRuleHandler>;

  constructor(
    private prisma: PrismaService,
    private budgetHandler: BudgetRuleHandler,
    private biddingHandler: BiddingStrategyRuleHandler,
    private bidLimitHandler: BidLimitRuleHandler,
  ) {
    this.registry = new Map();
    for (const handler of [budgetHandler, biddingHandler, bidLimitHandler]) {
      for (const action of handler.supports) {
        this.registry.set(action, handler);
      }
    }
  }

  async evaluateCampaign(
    campaign: CampaignWithAccount,
    rules: OptimizerRule[],
  ): Promise<EvaluationResult> {
    if (campaign.campaignPhase === CampaignPhase.LEARNING) return EMPTY;

    const metrics = await this.loadWeightedMetrics(campaign.id, 'CAMPAIGN');
    if (!metrics) return EMPTY;

    const applicableRules = rules.filter((r) => {
      if (r.platformScope !== 'ALL' && r.platformScope !== campaign.platform) return false;
      if (r.appliesToPhase !== 'ALL' && r.appliesToPhase !== campaign.campaignPhase) return false;
      return true;
    });

    const ctx: RuleHandlerContext = {
      orgId: campaign.orgId,
      entityType: 'CAMPAIGN',
      entityId: campaign.id,
      platform: campaign.platform as Platform,
      adAccountId: campaign.adAccount.id,
      adAccountCurrency: campaign.adAccount.currency,
      metrics,
      currentBaseline: campaign.dailyBudget !== null ? Number(campaign.dailyBudget) : null,
    };

    return this.dispatch(applicableRules, ctx);
  }

  async evaluateAdSet(
    adSet: AdSet & { campaign: CampaignWithAccount },
    rules: OptimizerRule[],
  ): Promise<EvaluationResult> {
    const campaign = adSet.campaign;
    if (campaign.campaignPhase === CampaignPhase.LEARNING) return EMPTY;

    const metrics = await this.loadWeightedMetrics(adSet.id, 'AD_SET');
    if (!metrics) return EMPTY;

    const applicableRules = rules.filter((r) => {
      if (r.platformScope !== 'ALL' && r.platformScope !== campaign.platform) return false;
      if (r.appliesToPhase !== 'ALL' && r.appliesToPhase !== campaign.campaignPhase) return false;
      // Budget rules at ad-set level only when not CBO
      if (
        (r.actionType === 'INCREASE_BUDGET' || r.actionType === 'DECREASE_BUDGET') &&
        campaign.isCbo
      ) return false;
      return true;
    });

    const ctx: RuleHandlerContext = {
      orgId: adSet.orgId,
      entityType: 'AD_SET',
      entityId: adSet.id,
      platform: campaign.platform as Platform,
      adAccountId: campaign.adAccount.id,
      adAccountCurrency: campaign.adAccount.currency,
      metrics,
      // Note: the evaluator does not load adSet.dailyBudget today. Preserved
      // as null so behavior matches the prior implementation; budget rules
      // on ad sets emit MISSING_BASELINE skips for the Insights layer.
      currentBaseline: null,
    };

    return this.dispatch(applicableRules, ctx);
  }

  private dispatch(rules: OptimizerRule[], ctx: RuleHandlerContext): EvaluationResult {
    const proposed: ProposedAction[] = [];
    const skipped: SkipReason[] = [];

    for (const rule of rules) {
      const handler = this.registry.get(rule.actionType);
      if (!handler) {
        this.logger.warn(`No rule handler registered for actionType=${rule.actionType} (rule ${rule.id})`);
        continue;
      }
      const result = handler.evaluate(rule, ctx);
      if (result.kind === 'proposed') proposed.push(result.action);
      else skipped.push(result.reason);
    }

    proposed.sort((a, b) => a.rulePriority - b.rulePriority);

    return { proposed, skipped };
  }

  private async loadWeightedMetrics(entityId: string, entityType: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshots = await this.prisma.metricSnapshot.findMany({
      where: { entityType, entityId, snapshotDate: today },
      orderBy: { windowHours: 'asc' },
    });

    if (!snapshots.find((s) => s.windowHours === 24)) {
      this.logger.debug(`No 24h snapshot for ${entityType} ${entityId}, skipping evaluation`);
      return null;
    }

    const get = (w: number) => snapshots.find((s) => s.windowHours === w);
    const w24 = get(24);
    const w48 = get(48);
    const w72 = get(72);

    return {
      roas: applyRecencyWeight({
        window24h: w24 ? Number(w24.roas) : null,
        window48h: w48 ? Number(w48.roas) : null,
        window72h: w72 ? Number(w72.roas) : null,
      }),
      cpa: applyRecencyWeight({
        window24h: w24 ? Number(w24.cpa) : null,
        window48h: w48 ? Number(w48.cpa) : null,
        window72h: w72 ? Number(w72.cpa) : null,
      }),
      cpc: applyRecencyWeight({
        window24h: w24 ? Number(w24.cpc) : null,
        window48h: w48 ? Number(w48.cpc) : null,
        window72h: w72 ? Number(w72.cpc) : null,
      }),
      ctr: applyRecencyWeight({
        window24h: w24 ? Number(w24.ctr) : null,
        window48h: w48 ? Number(w48.ctr) : null,
        window72h: w72 ? Number(w72.ctr) : null,
      }),
      spendPacing: applyRecencyWeight({
        window24h: w24 ? Number(w24.spendPacing) : null,
        window48h: w48 ? Number(w48.spendPacing) : null,
        window72h: w72 ? Number(w72.spendPacing) : null,
      }),
      impressions24h: w24 ? Number(w24.impressions) : 0,
    };
  }
}
