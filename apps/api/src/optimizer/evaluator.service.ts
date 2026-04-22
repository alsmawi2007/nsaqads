import { Injectable, Logger } from '@nestjs/common';
import { Campaign, AdSet, OptimizerRule, Platform, ActionType, CampaignPhase } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyRecencyWeight } from '../common/utils/recency-weight.util';
import { applyDelta } from '../common/utils/currency.util';
import { ProposedAction } from './dto/proposed-action.dto';

type CampaignWithAccount = Campaign & { adAccount: { id: string; currency: string } };

@Injectable()
export class EvaluatorService {
  private readonly logger = new Logger(EvaluatorService.name);

  constructor(private prisma: PrismaService) {}

  async evaluateCampaign(
    campaign: CampaignWithAccount,
    rules: OptimizerRule[],
  ): Promise<ProposedAction[]> {
    if (campaign.campaignPhase === CampaignPhase.LEARNING) return [];

    const metrics = await this.loadWeightedMetrics(campaign.id, 'CAMPAIGN');
    if (!metrics) return [];

    const applicableRules = rules.filter((r) => {
      if (r.platformScope !== 'ALL' && r.platformScope !== campaign.platform) return false;
      if (r.appliesToPhase !== 'ALL' && r.appliesToPhase !== campaign.campaignPhase) return false;
      return true;
    });

    return this.evaluateRules(campaign.id, 'CAMPAIGN', campaign.platform as Platform, campaign.adAccount, metrics, applicableRules, campaign);
  }

  async evaluateAdSet(
    adSet: AdSet & { campaign: CampaignWithAccount },
    rules: OptimizerRule[],
  ): Promise<ProposedAction[]> {
    const metrics = await this.loadWeightedMetrics(adSet.id, 'AD_SET');
    if (!metrics) return [];

    const campaign = adSet.campaign;
    if (campaign.campaignPhase === CampaignPhase.LEARNING) return [];

    const applicableRules = rules.filter((r) => {
      if (r.platformScope !== 'ALL' && r.platformScope !== adSet.campaign.platform) return false;
      if (r.appliesToPhase !== 'ALL' && r.appliesToPhase !== campaign.campaignPhase) return false;
      // Budget rules at ad-set level only when not CBO
      if (
        (r.actionType === 'INCREASE_BUDGET' || r.actionType === 'DECREASE_BUDGET') &&
        campaign.isCbo
      ) return false;
      return true;
    });

    return this.evaluateRules(adSet.id, 'AD_SET', adSet.campaign.platform as Platform, campaign.adAccount, metrics, applicableRules, null);
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

  private evaluateRules(
    entityId: string,
    entityType: 'CAMPAIGN' | 'AD_SET',
    platform: Platform,
    adAccount: { id: string; currency: string },
    metrics: Record<string, number | null>,
    rules: OptimizerRule[],
    campaign: CampaignWithAccount | null,
  ): ProposedAction[] {
    const actions: ProposedAction[] = [];

    for (const rule of rules) {
      const kpiValue = metrics[rule.kpiMetric];
      if (kpiValue === null || kpiValue === undefined) continue;

      const threshold = Number(rule.thresholdValue);

      // G5: minimum sample size
      if ((metrics['impressions24h'] ?? 0) < Number(rule.minSampleImpressions)) continue;

      if (!this.compare(kpiValue, rule.comparator, threshold)) continue;

      const currentBudget = entityType === 'CAMPAIGN'
        ? (campaign ? Number(campaign.dailyBudget) : null)
        : null;

      const deltaPct = rule.actionDelta ? Number(rule.actionDelta) : null;
      const proposedValue = (deltaPct !== null && currentBudget !== null)
        ? applyDelta(currentBudget, deltaPct, adAccount.currency)
        : null;

      const explanation = this.buildExplanation(rule, kpiValue, threshold, currentBudget, proposedValue, adAccount.currency);

      actions.push({
        orgId: campaign?.orgId ?? '',
        ruleId: rule.id,
        entityType,
        entityId,
        platform,
        actionType: rule.actionType as ActionType,
        deltaPct,
        targetValue: rule.actionTargetValue,
        currentValue: currentBudget,
        proposedValue,
        explanation,
        rulePriority: rule.priority,
        adAccountId: adAccount.id,
        adAccountCurrency: adAccount.currency,
      });
    }

    // R1: Sort by priority before returning (lower = higher priority)
    return actions.sort((a, b) => a.rulePriority - b.rulePriority);
  }

  private compare(value: number, comparator: string, threshold: number): boolean {
    switch (comparator) {
      case 'GT':  return value > threshold;
      case 'LT':  return value < threshold;
      case 'GTE': return value >= threshold;
      case 'LTE': return value <= threshold;
      case 'EQ':  return value === threshold;
      default:    return false;
    }
  }

  private buildExplanation(
    rule: OptimizerRule,
    kpiValue: number,
    threshold: number,
    currentBudget: number | null,
    proposedValue: number | null,
    currency: string,
  ): { en: string; ar: null } {
    const kpi = rule.kpiMetric.toUpperCase();
    const action = rule.actionType.replace(/_/g, ' ').toLowerCase();

    let en = `Rule "${rule.name}" triggered: ${kpi} was ${kpiValue.toFixed(2)} (threshold: ${rule.comparator} ${threshold}). `;

    if (currentBudget !== null && proposedValue !== null) {
      en += `Action: ${action} from ${currency} ${currentBudget.toFixed(2)} to ${currency} ${proposedValue.toFixed(2)}.`;
    } else if (rule.actionTargetValue) {
      en += `Action: ${action} to ${rule.actionTargetValue}.`;
    } else {
      en += `Action: ${action}.`;
    }

    return { en, ar: null };
  }
}
