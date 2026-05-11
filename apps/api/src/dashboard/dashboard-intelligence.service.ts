import { Injectable } from '@nestjs/common';
import { InsightsService } from '../insights/insights.service';
import { InsightAnalyticsService } from '../insights/analytics/insight-analytics.service';
import { RulePerformanceService } from '../insights/learning/rule-performance.service';
import { RuleTunerSimulationService } from '../insights/learning/rule-tuner-simulation.service';
import { RuleTunerService } from '../insights/learning/rule-tuner.service';
import { InsightDto, InsightListResponseDto, InsightType } from '../insights/dto/insight.dto';
import { InsightAnalyticsResponseDto } from '../insights/analytics/insight-analytics.dto';
import { RuleHealthResponseDto } from '../insights/learning/rule-performance.dto';
import { RuleHealth } from '../insights/learning/rule-performance.types';
import {
  RuleSimulationResponseDto,
  SimulatedActionType,
} from '../insights/learning/rule-tuner-simulation.dto';
import { RuleTunerObservabilityDto } from '../insights/learning/rule-tuner-history.dto';
import {
  DashboardAutoTuneStatusDto,
  DashboardHealthSummaryDto,
  DashboardRuleHealthSummaryDto,
  DashboardSimulationSummaryDto,
  DashboardTopInsightDto,
  DashboardTrendHighlightDto,
  OrgDashboardIntelligenceDto,
} from './dashboard-intelligence.dto';

const TOP_INSIGHTS_CAP = 10;
const TREND_HIGHLIGHTS_CAP = 5;
const NEEDS_TUNING_CAP = 5;

const TREND_INSIGHT_TYPES: ReadonlySet<InsightType> = new Set([
  InsightType.TREND_UP,
  InsightType.TREND_DOWN,
  InsightType.VOLATILITY_HIGH,
  InsightType.PERFORMANCE_STAGNANT,
]);

// Read-only operator dashboard. Aggregates the five existing intelligence
// services into one response so the UI makes a single call. Every leaf
// service is unchanged; this layer only reshapes + caps lists.
@Injectable()
export class DashboardIntelligenceService {
  constructor(
    private insights: InsightsService,
    private analytics: InsightAnalyticsService,
    private rulePerformance: RulePerformanceService,
    private ruleSimulation: RuleTunerSimulationService,
    private ruleTuner: RuleTunerService,
  ) {}

  async getIntelligenceForOrg(orgId: string, userId: string): Promise<OrgDashboardIntelligenceDto> {
    const [insightsList, analytics, ruleHealth, simulation, observability] = await Promise.all([
      this.insights.listForOrg(orgId, userId, {}),
      this.analytics.getForOrg(orgId),
      this.rulePerformance.getForOrg(orgId),
      this.ruleSimulation.getForOrg(orgId),
      this.ruleTuner.getObservability(orgId),
    ]);

    return {
      orgId,
      health:           buildHealthSummary(insightsList, analytics),
      topInsights:      buildTopInsights(insightsList),
      trendHighlights:  buildTrendHighlights(insightsList),
      ruleHealth:       buildRuleHealthSummary(ruleHealth),
      simulation:       buildSimulationSummary(simulation),
      autoTune:         buildAutoTuneStatus(observability),
      generatedAt:      new Date().toISOString(),
    };
  }
}

// ─── Builders (pure) ─────────────────────────────────────────────────────────

export function buildHealthSummary(
  insights: InsightListResponseDto,
  analytics: InsightAnalyticsResponseDto,
): DashboardHealthSummaryDto {
  return {
    totalActiveInsights: insights.insights.length,
    bySeverity: {
      info:   insights.totals.info,
      low:    insights.totals.low,
      medium: insights.totals.medium,
      high:   insights.totals.high,
    },
    totalInteractions:    analytics.totals.interactionCount,
    withFeedbackCount:    analytics.totals.withFeedbackCount,
    usefulRate:           analytics.totals.rates.usefulRate,
    notUsefulRate:        analytics.totals.rates.notUsefulRate,
    wrongRate:            analytics.totals.rates.wrongRate,
    needsMoreContextRate: analytics.totals.rates.needsMoreContextRate,
  };
}

export function buildTopInsights(insights: InsightListResponseDto): DashboardTopInsightDto[] {
  // listForOrg already returns insights sorted by score desc, so take the top N.
  // We re-shape to the dashboard DTO so the UI sees pre-resolved title/description strings.
  return insights.insights.slice(0, TOP_INSIGHTS_CAP).map(toTopInsight);
}

export function buildTrendHighlights(insights: InsightListResponseDto): DashboardTrendHighlightDto[] {
  return insights.insights
    .filter((i) => TREND_INSIGHT_TYPES.has(i.insightType))
    .slice(0, TREND_HIGHLIGHTS_CAP)
    .map(toTrendHighlight);
}

export function buildRuleHealthSummary(rh: RuleHealthResponseDto): DashboardRuleHealthSummaryDto {
  // RuleHealthSummaryDto.byHealth is keyed by enum string but we treat it as a
  // partial record because older records may not contain every key.
  const byHealth = rh.summary.byHealth as Partial<Record<RuleHealth, number>>;
  const healthy      = byHealth[RuleHealth.HEALTHY]       ?? 0;
  const needsTuning  = byHealth[RuleHealth.NEEDS_TUNING]  ?? 0;
  const unstable     = byHealth[RuleHealth.UNSTABLE]      ?? 0;
  const lowSignal    = byHealth[RuleHealth.LOW_SIGNAL]    ?? 0;

  // Pick rules that actually need attention. rh.rules is already sorted with
  // worst-health first by RulePerformanceService, but defensively re-filter.
  const topNeedsTuningRuleIds = rh.rules
    .filter((r) => r.health === RuleHealth.NEEDS_TUNING)
    .slice(0, NEEDS_TUNING_CAP)
    .map((r) => r.ruleId);

  return {
    totalRules: rh.summary.totalRules,
    healthy,
    needsTuning,
    unstable,
    lowSignal,
    averageRuleScore: rh.summary.averageRuleScore,
    topNeedsTuningRuleIds,
  };
}

export function buildSimulationSummary(sim: RuleSimulationResponseDto): DashboardSimulationSummaryDto {
  return {
    isShadowMode: true,
    totalRules: sim.summary.totalRules,
    rulesByAction: {
      [SimulatedActionType.NO_CHANGE]:         sim.summary.rulesByAction[SimulatedActionType.NO_CHANGE]         ?? 0,
      [SimulatedActionType.TIGHTEN_THRESHOLD]: sim.summary.rulesByAction[SimulatedActionType.TIGHTEN_THRESHOLD] ?? 0,
      [SimulatedActionType.DISABLE_RULE]:      sim.summary.rulesByAction[SimulatedActionType.DISABLE_RULE]      ?? 0,
      [SimulatedActionType.RAISE_SCORE_FLOOR]: sim.summary.rulesByAction[SimulatedActionType.RAISE_SCORE_FLOOR] ?? 0,
    },
    totalProjectedActionDelta: sim.summary.totalProjectedActionDelta,
    highConfidenceRuleCount:   sim.summary.highConfidenceRuleCount,
    lookbackDays:              sim.lookbackDays,
  };
}

export function buildAutoTuneStatus(obs: RuleTunerObservabilityDto): DashboardAutoTuneStatusDto {
  const last = obs.lastAppliedRun;
  return {
    totalRuns:               obs.totalRuns,
    totalAppliedChanges:     obs.totalAppliedChanges,
    totalRolledBackChanges:  obs.totalRolledBackChanges,
    lastRunId:               last?.runId          ?? null,
    lastRunStartedAt:        last?.startedAt      ?? null,
    lastRunFinishedAt:       last?.finishedAt     ?? null,
    lastRunAppliedCount:     last?.appliedCount   ?? null,
    lastRunRolledBackCount:  last?.rolledBackCount ?? null,
    cooldownActive:           obs.cooldownActive,
    cooldownExpiresAt:        obs.cooldownExpiresAt,
    cooldownRemainingMinutes: obs.cooldownRemainingMinutes,
  };
}

// ─── Translators ────────────────────────────────────────────────────────────

function toTopInsight(i: InsightDto): DashboardTopInsightDto {
  return {
    id:                i.id,
    insightType:       i.insightType,
    severity:          i.severity,
    priority:          i.priority,
    score:             i.score,
    title:             i.title.en,
    description:       i.description.en,
    entityType:        i.entityType,
    entityId:          i.entityId,
    entityName:        i.entityName,
    platform:          i.platform,
    relatedRuleId:     i.relatedRuleId,
    relatedActionType: i.relatedActionType,
  };
}

function toTrendHighlight(i: InsightDto): DashboardTrendHighlightDto {
  return {
    id:           i.id,
    insightType:  i.insightType,
    entityType:   i.entityType,
    entityId:     i.entityId,
    entityName:   i.entityName,
    platform:     i.platform,
    severity:     i.severity,
    score:        i.score,
    title:        i.title.en,
  };
}

