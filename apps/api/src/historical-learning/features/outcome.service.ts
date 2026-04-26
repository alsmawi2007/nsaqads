import { Injectable, Logger } from '@nestjs/common';
import {
  Campaign,
  CampaignGoal,
  CampaignPlan,
  DataQuality,
  MetricSnapshot,
  OutcomeAudienceType,
  OutcomeCreativeType,
  OutcomeFunnelStage,
  OutcomeLanguage,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const COMPLETION_GRACE_HOURS = 24;
const OUTLIER_SPEND_FACTOR = 25; // a row whose spend is 25× the campaign median is suspect

@Injectable()
export class OutcomeService {
  private readonly logger = new Logger(OutcomeService.name);

  constructor(private prisma: PrismaService) {}

  // Seals completed campaigns into immutable CampaignOutcome rows.
  // Idempotent: re-running for the same orgId is safe (skipIfSealed prevents dupes).
  async sealCompletedForOrg(orgId: string): Promise<{ sealed: number; skipped: number }> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - COMPLETION_GRACE_HOURS * 3_600_000);

    const candidates = await this.prisma.campaign.findMany({
      where: {
        orgId,
        deletedAt: null,
        sourcePlanId: { not: null },
        OR: [
          { status: 'ARCHIVED' },
          { endDate: { lt: cutoff } },
          { status: 'PAUSED', updatedAt: { lt: cutoff } },
        ],
      },
      include: { sourcePlan: { include: { items: true } } },
    });

    let sealed = 0;
    let skipped = 0;

    for (const campaign of candidates) {
      const already = await this.prisma.campaignOutcome.findFirst({
        where: { orgId, campaignId: campaign.id },
        select: { id: true },
      });
      if (already) {
        skipped++;
        continue;
      }
      const ok = await this.sealCampaign(campaign).catch((err: unknown) => {
        this.logger.warn(
          `Sealing failed for campaign ${campaign.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      });
      if (ok) sealed++;
      else skipped++;
    }

    return { sealed, skipped };
  }

  private async sealCampaign(
    campaign: Campaign & { sourcePlan: (CampaignPlan & { items: unknown[] }) | null },
  ): Promise<boolean> {
    const plan = campaign.sourcePlan;
    if (!plan) return false;

    // Aggregate all 24h snapshots for this campaign.
    const snapshots = await this.prisma.metricSnapshot.findMany({
      where: {
        orgId: campaign.orgId,
        entityType: 'CAMPAIGN',
        entityId: campaign.id,
        windowHours: 24,
      },
      orderBy: { snapshotDate: 'asc' },
    });

    if (snapshots.length === 0) return false;

    const cleanSnapshots = this.filterOutliers(snapshots);
    const totals = this.aggregate(cleanSnapshots);
    if (totals.impressions === 0n && totals.spend === 0) return false;

    const startedAt = snapshots[0].snapshotDate;
    const endedAt = snapshots[snapshots.length - 1].snapshotDate;
    const durationDays = Math.max(
      1,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 86_400_000) + 1,
    );

    const dimensions = this.classifyOutcome(plan as CampaignPlan, campaign);

    await this.prisma.campaignOutcome.create({
      data: {
        orgId: campaign.orgId,
        campaignPlanId: plan.id,
        campaignId: campaign.id,
        platform: campaign.platform,
        goal: plan.goal,
        funnelStage: dimensions.funnelStage,
        audienceType: dimensions.audienceType,
        creativeType: dimensions.creativeType,
        language: dimensions.language,
        vertical: dimensions.vertical,
        geoCountry: dimensions.geoCountry,
        geoRegion: dimensions.geoRegion,
        startedAt,
        endedAt,
        durationDays,
        spend: new Prisma.Decimal(totals.spend.toString()),
        impressions: totals.impressions,
        clicks: totals.clicks,
        conversions: totals.conversions,
        revenue: new Prisma.Decimal(totals.revenue.toString()),
        ctr: new Prisma.Decimal(totals.ctr.toString()),
        cpc: new Prisma.Decimal(totals.cpc.toString()),
        cpa: new Prisma.Decimal(totals.cpa.toString()),
        roas: new Prisma.Decimal(totals.roas.toString()),
        cpm: new Prisma.Decimal(totals.cpm.toString()),
        dataQuality:
          cleanSnapshots.length < snapshots.length
            ? DataQuality.OUTLIER_FILTERED
            : DataQuality.CLEAN,
        outlierFlags: snapshots.length === cleanSnapshots.length
          ? Prisma.JsonNull
          : (this.outlierFlags(snapshots, cleanSnapshots) as never),
      },
    });

    return true;
  }

  // ─── Aggregation ───────────────────────────────────────────────────────────

  private aggregate(snaps: MetricSnapshot[]) {
    let spend = 0;
    let impressions = 0n;
    let clicks = 0n;
    let conversions = 0n;
    let revenue = 0;

    for (const s of snaps) {
      spend += Number(s.spend);
      impressions += s.impressions;
      clicks += s.clicks;
      conversions += s.conversions;
      revenue += Number(s.revenue);
    }

    const impr = Number(impressions);
    const clk = Number(clicks);
    const conv = Number(conversions);

    return {
      spend,
      impressions,
      clicks,
      conversions,
      revenue,
      ctr: impr > 0 ? clk / impr : 0,
      cpc: clk > 0 ? spend / clk : 0,
      cpa: conv > 0 ? spend / conv : 0,
      roas: spend > 0 ? revenue / spend : 0,
      cpm: impr > 0 ? (spend / impr) * 1000 : 0,
    };
  }

  private filterOutliers(snaps: MetricSnapshot[]): MetricSnapshot[] {
    if (snaps.length < 4) return snaps;
    const spends = snaps.map((s) => Number(s.spend)).sort((a, b) => a - b);
    const median = spends[Math.floor(spends.length / 2)] || 0;
    if (median <= 0) return snaps;
    return snaps.filter((s) => Number(s.spend) <= median * OUTLIER_SPEND_FACTOR);
  }

  private outlierFlags(all: MetricSnapshot[], clean: MetricSnapshot[]) {
    const cleanIds = new Set(clean.map((s) => s.id));
    return all
      .filter((s) => !cleanIds.has(s.id))
      .map((s) => ({ snapshotId: s.id, snapshotDate: s.snapshotDate, reason: 'SPEND_SPIKE' }));
  }

  // ─── Outcome dimension classification ──────────────────────────────────────

  private classifyOutcome(plan: CampaignPlan, campaign: Campaign) {
    const audienceType = this.classifyAudience(plan);
    const creativeType = this.classifyCreative(plan);
    const language = this.classifyLanguage(plan);
    const funnelStage = this.classifyFunnel(plan.goal);
    const geoCountry = readGeoCountry(plan.geography);

    return {
      audienceType,
      creativeType,
      language,
      funnelStage,
      vertical: readVertical(plan.wizardAnswers),
      geoCountry,
      geoRegion: null as string | null,
    };
  }

  private classifyAudience(plan: CampaignPlan): OutcomeAudienceType {
    const hints = plan.audienceHints as Prisma.JsonObject | null;
    if (!hints) return OutcomeAudienceType.UNKNOWN;
    const tags = (hints.interestTags as unknown as string[]) ?? [];
    if (tags.length > 0) return OutcomeAudienceType.COLD_INTEREST;
    return OutcomeAudienceType.COLD_BROAD;
  }

  private classifyCreative(plan: CampaignPlan): OutcomeCreativeType {
    const brief = plan.creativeBrief as Prisma.JsonObject;
    const formats = (brief?.formats as unknown as string[]) ?? [];
    const f = (formats[0] ?? '').toLowerCase();
    if (f.includes('vertical') || f === 'reel' || f === 'tiktok_video') {
      return OutcomeCreativeType.VERTICAL_VIDEO;
    }
    if (f.includes('square')) return OutcomeCreativeType.SQUARE_VIDEO;
    if (f.includes('horizontal') || f === 'youtube_video') return OutcomeCreativeType.HORIZONTAL_VIDEO;
    if (f === 'static' || f === 'image') return OutcomeCreativeType.STATIC_IMAGE;
    if (f === 'carousel') return OutcomeCreativeType.CAROUSEL;
    if (f === 'collection') return OutcomeCreativeType.COLLECTION;
    if (f === 'dpa') return OutcomeCreativeType.DPA;
    if (f === 'ar_lens' || f === 'lens') return OutcomeCreativeType.AR_LENS;
    if (f === 'story') return OutcomeCreativeType.STORY;
    return OutcomeCreativeType.UNKNOWN;
  }

  private classifyLanguage(plan: CampaignPlan): OutcomeLanguage {
    const hints = plan.audienceHints as Prisma.JsonObject | null;
    const langs = (hints?.languages as unknown as string[] | null) ?? null;
    if (!langs || langs.length === 0) return OutcomeLanguage.UNKNOWN;
    const lower = langs.map((l) => l.toLowerCase());
    const hasAr = lower.some((l) => l.startsWith('ar'));
    const hasEn = lower.some((l) => l.startsWith('en'));
    if (hasAr && hasEn) return OutcomeLanguage.AR_EN_MIXED;
    if (hasAr) return OutcomeLanguage.AR;
    if (hasEn) return OutcomeLanguage.EN;
    return OutcomeLanguage.UNKNOWN;
  }

  private classifyFunnel(goal: CampaignGoal): OutcomeFunnelStage {
    switch (goal) {
      case 'AWARENESS':
      case 'TRAFFIC':
        return OutcomeFunnelStage.TOF;
      case 'ENGAGEMENT':
      case 'LEADS':
      case 'APP_INSTALLS':
        return OutcomeFunnelStage.MOF;
      case 'SALES':
        return OutcomeFunnelStage.BOF;
    }
  }
}

function readGeoCountry(geo: Prisma.JsonValue | null): string | null {
  if (!geo || typeof geo !== 'object') return null;
  const obj = geo as Prisma.JsonObject;
  const countries = obj.countries as unknown as string[] | null;
  if (countries && countries.length === 1) return countries[0].toUpperCase();
  return null;
}

function readVertical(answers: Prisma.JsonValue): string | null {
  if (!answers || typeof answers !== 'object') return null;
  const obj = answers as Prisma.JsonObject;
  const v = obj.vertical;
  return typeof v === 'string' && v.length > 0 ? v.toUpperCase() : null;
}
