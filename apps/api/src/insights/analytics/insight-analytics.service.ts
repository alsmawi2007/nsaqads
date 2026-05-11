import { Injectable } from '@nestjs/common';
import { InsightFeedback, InsightInteraction, InsightInteractionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InsightAdminAnalyticsResponseDto,
  InsightAnalyticsBlock,
  InsightAnalyticsBlockDto,
  InsightAnalyticsBucketDto,
  InsightAnalyticsResponseDto,
  InsightRuleAnalyticsBucketDto,
  InsightRulesAnalyticsResponseDto,
} from './insight-analytics.dto';

// Read-only analytics over insight_interactions. Insights themselves are not
// persisted, so all aggregation is over the per-user lifecycle/feedback
// records — keyed by metadata that was captured when the user acted.
//
// All rate denominators are subset counts (rows that actually have the
// relevant column populated) so a single user who only marked SEEN doesn't
// drag the usefulRate down: the usefulRate denominator is "rows with
// feedback non-null", not "all rows".
@Injectable()
export class InsightAnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getForOrg(orgId: string): Promise<InsightAnalyticsResponseDto> {
    const rows = await this.prisma.insightInteraction.findMany({ where: { orgId } });

    return {
      orgId,
      totals: blockToDto(aggregate(rows)),
      byInsightType:  bucketsToDto(groupBy(rows, (r) => r.insightType)),
      byPriority:     bucketsToDto(groupBy(rows, (r) => r.priority)),
      byPlatform:     bucketsToDto(groupBy(rows, (r) => (r.platform ?? null) as string | null)),
      byActionType:   bucketsToDto(groupBy(rows, (r) => (r.relatedActionType ?? null) as string | null)),
      byUser:         bucketsToDto(groupBy(rows, (r) => r.userId)),
      generatedAt: new Date().toISOString(),
    };
  }

  async getForRules(orgId: string): Promise<InsightRulesAnalyticsResponseDto> {
    const rows = await this.prisma.insightInteraction.findMany({ where: { orgId } });

    const byRule = groupBy(rows, (r) => r.relatedRuleId);
    const rules: InsightRuleAnalyticsBucketDto[] = [];
    let uncategorizedCount = 0;

    for (const [ruleId, group] of byRule) {
      if (ruleId === null) {
        // Insights without a source rule (e.g. trend signals, learning-phase
        // notices) don't fit per-rule analytics. Reported separately so the
        // caller knows how much volume is unattributable.
        uncategorizedCount = group.length;
        continue;
      }
      rules.push({ ruleId, ...blockToDto(aggregate(group)) });
    }

    // Sort by interaction volume so the loudest rules float to the top.
    rules.sort((a, b) => b.interactionCount - a.interactionCount);

    return { orgId, rules, uncategorizedCount, generatedAt: new Date().toISOString() };
  }

  async getForAdmin(): Promise<InsightAdminAnalyticsResponseDto> {
    const rows = await this.prisma.insightInteraction.findMany({});

    return {
      totals:        blockToDto(aggregate(rows)),
      byOrg:         groupAndProject(rows, (r) => r.orgId, (key, block) => ({ orgId: key ?? '', ...blockToDto(block) })),
      byInsightType: bucketsToDto(groupBy(rows, (r) => r.insightType)),
      byPlatform:    bucketsToDto(groupBy(rows, (r) => (r.platform ?? null) as string | null)),
      generatedAt: new Date().toISOString(),
    };
  }
}

// ─── Aggregation helpers ────────────────────────────────────────────────────

function aggregate(rows: InsightInteraction[]): InsightAnalyticsBlock {
  const statusCounts: Record<InsightInteractionStatus, number> = {
    SEEN: 0, DISMISSED: 0, SAVED: 0,
  };
  const feedbackCounts: Record<InsightFeedback, number> = {
    USEFUL: 0, NOT_USEFUL: 0, WRONG: 0, NEEDS_MORE_CONTEXT: 0,
  };

  let withStatusCount = 0;
  let withFeedbackCount = 0;

  for (const row of rows) {
    if (row.status) {
      statusCounts[row.status]++;
      withStatusCount++;
    }
    if (row.feedback) {
      feedbackCounts[row.feedback]++;
      withFeedbackCount++;
    }
  }

  // Rates use subset denominators so a row with only `status` doesn't
  // dilute feedback rates and vice versa. Zero-volume buckets emit 0
  // (not NaN) so the response is JSON-safe.
  const rateOver = (n: number, d: number): number => (d === 0 ? 0 : round4(n / d));
  return {
    interactionCount: rows.length,
    withStatusCount,
    withFeedbackCount,
    statusCounts,
    feedbackCounts,
    rates: {
      seenRate:             rateOver(statusCounts.SEEN, withStatusCount),
      dismissedRate:        rateOver(statusCounts.DISMISSED, withStatusCount),
      savedRate:            rateOver(statusCounts.SAVED, withStatusCount),
      usefulRate:           rateOver(feedbackCounts.USEFUL, withFeedbackCount),
      notUsefulRate:        rateOver(feedbackCounts.NOT_USEFUL, withFeedbackCount),
      wrongRate:            rateOver(feedbackCounts.WRONG, withFeedbackCount),
      needsMoreContextRate: rateOver(feedbackCounts.NEEDS_MORE_CONTEXT, withFeedbackCount),
    },
  };
}

function groupBy(
  rows: InsightInteraction[],
  keyOf: (row: InsightInteraction) => string | null,
): Map<string | null, InsightInteraction[]> {
  const map = new Map<string | null, InsightInteraction[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const arr = map.get(key) ?? [];
    arr.push(row);
    map.set(key, arr);
  }
  return map;
}

function groupAndProject<T>(
  rows: InsightInteraction[],
  keyOf: (row: InsightInteraction) => string | null,
  project: (key: string | null, block: InsightAnalyticsBlock) => T,
): T[] {
  const map = groupBy(rows, keyOf);
  return [...map.entries()].map(([k, group]) => project(k, aggregate(group)));
}

function blockToDto(block: InsightAnalyticsBlock): InsightAnalyticsBlockDto {
  return {
    interactionCount:  block.interactionCount,
    withStatusCount:   block.withStatusCount,
    withFeedbackCount: block.withFeedbackCount,
    statusCounts: { ...block.statusCounts },
    feedbackCounts: { ...block.feedbackCounts },
    rates: { ...block.rates },
  };
}

function bucketsToDto(map: Map<string | null, InsightInteraction[]>): InsightAnalyticsBucketDto[] {
  const out: InsightAnalyticsBucketDto[] = [];
  for (const [key, group] of map) {
    out.push({ key, ...blockToDto(aggregate(group)) });
  }
  // Bigger buckets first; null buckets (missing metadata) trail.
  out.sort((a, b) => {
    if (a.key === null && b.key !== null) return 1;
    if (b.key === null && a.key !== null) return -1;
    return b.interactionCount - a.interactionCount;
  });
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
