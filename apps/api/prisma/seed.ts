/**
 * Prisma seed script — creates a complete demo dataset for development and E2E testing.
 *
 * Run: npx prisma db seed
 *
 * Seeds:
 *   • 1 demo user (admin@nsaq.io / Password123!)
 *   • 1 demo org (Nsaq Demo)
 *   • 4 ad accounts (META, TIKTOK, GOOGLE_ADS, SNAPCHAT) — all MOCK status
 *   • 5 campaigns matching frontend mock data (one per phase)
 *   • 11 ad sets distributed across campaigns
 *   • MetricSnapshots at 24h, 48h, 72h windows for each campaign
 *   • 4 global optimizer rules
 *   • 16 optimizer actions spanning 4 days (APPLIED, PENDING, FAILED, SKIPPED, ROLLED_BACK)
 *   • 4 alerts
 *   • 6 global AdminSettings (optimizer config)
 */

import { PrismaClient, Prisma, CampaignPhase, OptimizerMode, Platform, EntityStatus, ActionType, ActionStatus, TriggeredBy, AlertType, AlertSeverity, RuleFamily, RuleComparator, PlatformScope, PhaseScope } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}
function daysAgo(d: number, extraHours = 0): Date {
  return hoursAgo(d * 24 + extraHours);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…');

  // ── User ──────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const user = await prisma.user.upsert({
    where: { email: 'admin@nsaq.io' },
    update: {},
    create: {
      email: 'admin@nsaq.io',
      passwordHash,
      name: 'Demo Admin',
      preferredLang: 'en',
      isSystemAdmin: true,
    },
  });
  console.log(`  ✔ User: ${user.email}`);

  // ── Organization ──────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'nsaq-demo' },
    update: {},
    create: {
      name: 'Nsaq Demo',
      slug: 'nsaq-demo',
      plan: 'PRO',
    },
  });
  console.log(`  ✔ Org: ${org.name} (${org.id})`);

  // ── Membership ────────────────────────────────────────────────────────────
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: {
      orgId: org.id,
      userId: user.id,
      role: 'OWNER',
      joinedAt: new Date(),
    },
  });
  console.log('  ✔ Membership: OWNER');

  // ── Ad Accounts ───────────────────────────────────────────────────────────
  const ACCOUNTS: Array<{ platform: Platform; externalId: string; name: string }> = [
    { platform: Platform.META,       externalId: 'act_meta_001',     name: 'Meta Ads — KSA' },
    { platform: Platform.TIKTOK,     externalId: 'act_tiktok_001',   name: 'TikTok Ads — KSA' },
    { platform: Platform.GOOGLE_ADS, externalId: 'act_google_001',   name: 'Google Ads — KSA' },
    { platform: Platform.SNAPCHAT,   externalId: 'act_snapchat_001', name: 'Snapchat Ads — KSA' },
  ];

  const adAccountMap: Record<string, string> = {};
  for (const acc of ACCOUNTS) {
    const account = await prisma.adAccount.upsert({
      where: { orgId_platform_externalId: { orgId: org.id, platform: acc.platform, externalId: acc.externalId } },
      update: {},
      create: {
        orgId: org.id,
        platform: acc.platform,
        externalId: acc.externalId,
        name: acc.name,
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
        accessToken: 'mock-token-encrypted',
        status: 'MOCK' as never,
        lastSyncedAt: new Date(),
      },
    });
    adAccountMap[acc.platform] = account.id;
    console.log(`  ✔ AdAccount: ${acc.name}`);
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────
  const CAMPAIGNS: Array<{
    key: string;
    name: string;
    platform: Platform;
    status: EntityStatus;
    phase: CampaignPhase;
    mode: OptimizerMode;
    dailyBudget: number;
    isCbo: boolean;
  }> = [
    { key: 'cmp-001', name: 'Ramadan Performance — Riyadh',       platform: Platform.META,       status: EntityStatus.ACTIVE,  phase: CampaignPhase.SCALING,   mode: OptimizerMode.AUTO_APPLY,   dailyBudget: 3000, isCbo: true  },
    { key: 'cmp-002', name: 'Brand Awareness Q2 — KSA',           platform: Platform.TIKTOK,     status: EntityStatus.ACTIVE,  phase: CampaignPhase.STABLE,    mode: OptimizerMode.AUTO_APPLY,   dailyBudget: 1500, isCbo: false },
    { key: 'cmp-003', name: 'Retargeting — Checkout Abandonment', platform: Platform.META,       status: EntityStatus.ACTIVE,  phase: CampaignPhase.STABLE,    mode: OptimizerMode.SUGGEST_ONLY, dailyBudget: 800,  isCbo: true  },
    { key: 'cmp-004', name: 'Google Search — High Intent',        platform: Platform.GOOGLE_ADS, status: EntityStatus.ACTIVE,  phase: CampaignPhase.LEARNING,  mode: OptimizerMode.SUGGEST_ONLY, dailyBudget: 2000, isCbo: false },
    { key: 'cmp-005', name: 'Snapchat Discover — Jeddah',         platform: Platform.SNAPCHAT,   status: EntityStatus.PAUSED,  phase: CampaignPhase.DEGRADED,  mode: OptimizerMode.OFF,          dailyBudget: 600,  isCbo: false },
  ];

  const campaignIdMap: Record<string, string> = {};
  for (const c of CAMPAIGNS) {
    const campaign = await prisma.campaign.upsert({
      where: { adAccountId_externalId: { adAccountId: adAccountMap[c.platform], externalId: c.key } },
      update: {},
      create: {
        orgId: org.id,
        adAccountId: adAccountMap[c.platform],
        externalId: c.key,
        name: c.name,
        platform: c.platform,
        status: c.status,
        objective: 'CONVERSIONS',
        dailyBudget: c.dailyBudget,
        isCbo: c.isCbo,
        campaignPhase: c.phase,
        optimizerMode: c.mode,
        optimizerEnabled: c.mode !== OptimizerMode.OFF,
        syncedAt: new Date(),
      },
    });
    campaignIdMap[c.key] = campaign.id;
    console.log(`  ✔ Campaign: ${c.name}`);
  }

  // ── Ad Sets ───────────────────────────────────────────────────────────────
  const AD_SETS: Array<{
    key: string;
    campaignKey: string;
    name: string;
    biddingStrategy: string;
    dailyBudget: number | null;
    bidAmount?: number;
  }> = [
    { key: 'ads-001a', campaignKey: 'cmp-001', name: 'Core Audience — Purchase Intent KSA',  biddingStrategy: 'LOWEST_COST', dailyBudget: null },
    { key: 'ads-001b', campaignKey: 'cmp-001', name: 'Lookalike — Top 5% Purchasers',         biddingStrategy: 'LOWEST_COST', dailyBudget: null },
    { key: 'ads-002a', campaignKey: 'cmp-002', name: 'Interest Targeting — Fashion & Lifestyle', biddingStrategy: 'COST_CAP', dailyBudget: 900, bidAmount: 18 },
    { key: 'ads-002b', campaignKey: 'cmp-002', name: 'Retargeting — Engaged Viewers 30s',     biddingStrategy: 'BID_CAP',   dailyBudget: 600, bidAmount: 13 },
    { key: 'ads-003a', campaignKey: 'cmp-003', name: 'Warm Audience — 7-day visitors',        biddingStrategy: 'LOWEST_COST', dailyBudget: null },
    { key: 'ads-003b', campaignKey: 'cmp-003', name: 'Cold Audience — Lookalike 1%',          biddingStrategy: 'LOWEST_COST', dailyBudget: null },
    { key: 'ads-004a', campaignKey: 'cmp-004', name: 'Branded Keywords — Exact Match',        biddingStrategy: 'TARGET_CPA', dailyBudget: 1200, bidAmount: 20 },
    { key: 'ads-004b', campaignKey: 'cmp-004', name: 'Non-Brand Keywords — Broad',            biddingStrategy: 'TARGET_CPA', dailyBudget: 800, bidAmount: 20 },
    { key: 'ads-005a', campaignKey: 'cmp-005', name: 'Top of Funnel — 18-34 Jeddah',          biddingStrategy: 'LOWEST_COST', dailyBudget: 400 },
    { key: 'ads-005b', campaignKey: 'cmp-005', name: 'Retargeting — Story Viewers',           biddingStrategy: 'LOWEST_COST', dailyBudget: 200 },
  ];

  const adSetIdMap: Record<string, string> = {};
  for (const s of AD_SETS) {
    const adSet = await prisma.adSet.upsert({
      where: { campaignId_externalId: { campaignId: campaignIdMap[s.campaignKey], externalId: s.key } },
      update: {},
      create: {
        orgId: org.id,
        campaignId: campaignIdMap[s.campaignKey],
        externalId: s.key,
        name: s.name,
        status: EntityStatus.ACTIVE,
        biddingStrategy: s.biddingStrategy,
        dailyBudget: s.dailyBudget,
        bidAmount: s.bidAmount ?? null,
        optimizerMode: CAMPAIGNS.find(c => c.key === s.campaignKey)!.mode,
        optimizerEnabled: CAMPAIGNS.find(c => c.key === s.campaignKey)!.mode !== OptimizerMode.OFF,
        syncedAt: new Date(),
      },
    });
    adSetIdMap[s.key] = adSet.id;
  }
  console.log(`  ✔ Ad sets: ${AD_SETS.length} created`);

  // ── Metric Snapshots ──────────────────────────────────────────────────────
  const CAMPAIGN_METRICS: Record<string, { spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversions: number; cpa: number; revenue: number; roas: number; spendPacing: number }> = {
    'cmp-001': { spend: 2840, impressions: 91_613, clicks: 2840, ctr: 0.031, cpc: 1.00, conversions: 289, cpa: 9.80, revenue: 11_700, roas: 4.12, spendPacing: 0.95 },
    'cmp-002': { spend: 1102, impressions: 50_091, clicks: 1102, ctr: 0.022, cpc: 1.00, conversions:  77, cpa: 14.3, revenue: 3_164,  roas: 2.87, spendPacing: 0.73 },
    'cmp-003': { spend:  788, impressions: 16_417, clicks:  788, ctr: 0.048, cpc: 1.00, conversions: 111, cpa: 7.10, revenue: 4_413,  roas: 5.60, spendPacing: 0.99 },
    'cmp-004': { spend:  820, impressions: 45_556, clicks:  820, ctr: 0.018, cpc: 1.00, conversions:  36, cpa: 22.8, revenue: 1_558,  roas: 1.90, spendPacing: 0.41 },
    'cmp-005': { spend:    0, impressions:      0, clicks:    0, ctr: 0.009, cpc: 0.00, conversions:   4, cpa: 38.9, revenue:   200,  roas: 0.80, spendPacing: 0.00 },
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const [cmpKey, metrics] of Object.entries(CAMPAIGN_METRICS)) {
    const entityId = campaignIdMap[cmpKey];
    const campaign = CAMPAIGNS.find(c => c.key === cmpKey)!;

    for (const windowHours of [24, 48, 72]) {
      const snapshotDate = new Date(today.getTime() - (windowHours - 24) * 3_600_000);

      await prisma.metricSnapshot.upsert({
        where: { entityType_entityId_snapshotDate_windowHours: {
          entityType: 'CAMPAIGN',
          entityId,
          snapshotDate,
          windowHours,
        }},
        update: {},
        create: {
          orgId: org.id,
          entityType: 'CAMPAIGN',
          entityId,
          platform: campaign.platform,
          snapshotDate,
          windowHours,
          spend: metrics.spend * (windowHours / 24),
          impressions: BigInt(Math.round(metrics.impressions * (windowHours / 24))),
          clicks: BigInt(Math.round(metrics.clicks * (windowHours / 24))),
          ctr: metrics.ctr,
          cpc: metrics.cpc,
          conversions: BigInt(Math.round(metrics.conversions * (windowHours / 24))),
          cpa: metrics.cpa,
          revenue: metrics.spend * metrics.roas * (windowHours / 24),
          roas: metrics.roas,
          reach: BigInt(Math.round(metrics.impressions * 0.8 * (windowHours / 24))),
          frequency: 1.25,
          spendPacing: metrics.spendPacing,
        },
      });
    }
  }
  console.log('  ✔ Metric snapshots: 15 created (5 campaigns × 3 windows)');

  // ── Global Optimizer Rules ────────────────────────────────────────────────
  const RULES = [
    {
      name: 'High ROAS — Budget Scale',
      ruleFamily: RuleFamily.BUDGET,
      kpiMetric: 'roas',
      comparator: RuleComparator.GTE,
      thresholdValue: 3.0,
      consecutiveWindows: 3,
      actionType: ActionType.INCREASE_BUDGET,
      actionDelta: 15,
      priority: 10,
      appliesToPhase: PhaseScope.STABLE,
      description: 'Scale budget when ROAS exceeds 3.0x for 3 consecutive 24h windows',
    },
    {
      name: 'Degraded ROAS — Budget Cut',
      ruleFamily: RuleFamily.BUDGET,
      kpiMetric: 'roas',
      comparator: RuleComparator.LT,
      thresholdValue: 1.0,
      consecutiveWindows: 3,
      actionType: ActionType.DECREASE_BUDGET,
      actionDelta: -40,
      priority: 5,
      appliesToPhase: PhaseScope.ALL,
      description: 'Reduce budget aggressively when ROAS falls below unprofitability threshold',
    },
    {
      name: 'CPA Breach — Strategy Downgrade',
      ruleFamily: RuleFamily.BIDDING_STRATEGY,
      kpiMetric: 'cpa',
      comparator: RuleComparator.GT,
      thresholdValue: 13.0,
      consecutiveWindows: 2,
      actionType: ActionType.SWITCH_BIDDING_STRATEGY,
      actionTargetValue: 'COST_CAP',
      priority: 20,
      appliesToPhase: PhaseScope.ALL,
      description: 'Switch to Cost Cap when CPA exceeds SAR 13 for 2 consecutive windows',
    },
    {
      name: 'Low CTR — Spend Reduction',
      ruleFamily: RuleFamily.BUDGET,
      kpiMetric: 'ctr',
      comparator: RuleComparator.LT,
      thresholdValue: 0.02,
      consecutiveWindows: 2,
      actionType: ActionType.DECREASE_BUDGET,
      actionDelta: -20,
      priority: 30,
      appliesToPhase: PhaseScope.STABLE,
      description: 'Reduce budget when CTR drops below 2% signaling creative fatigue',
    },
  ];

  for (const rule of RULES) {
    const existing = await prisma.optimizerRule.findFirst({ where: { name: rule.name, orgId: null } });
    if (!existing) {
      await prisma.optimizerRule.create({
        data: {
          orgId: null,
          ruleFamily: rule.ruleFamily,
          name: rule.name,
          description: rule.description,
          isEnabled: true,
          priority: rule.priority,
          kpiMetric: rule.kpiMetric,
          comparator: rule.comparator,
          thresholdValue: rule.thresholdValue,
          consecutiveWindows: rule.consecutiveWindows,
          actionType: rule.actionType,
          actionDelta: rule.actionDelta ?? null,
          actionTargetValue: rule.actionTargetValue ?? null,
          minSampleImpressions: 500,
          platformScope: PlatformScope.ALL,
          appliesToPhase: rule.appliesToPhase,
        },
      });
    }
  }
  console.log('  ✔ Optimizer rules: 4 global rules created');

  // ── Optimizer Actions ─────────────────────────────────────────────────────
  type ActionSeed = {
    key: string;
    campaignKey: string;
    adSetKey: string | null;
    entityType: 'CAMPAIGN' | 'AD_SET';
    platform: Platform;
    actionType: ActionType;
    status: ActionStatus;
    triggeredBy: TriggeredBy;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    explanation: { en: string; ar: null };
    errorMessage?: string;
    createdAt: Date;
    appliedAt: Date | null;
  };

  const ACTIONS: ActionSeed[] = [
    // Today
    {
      key: 'act-t01', campaignKey: 'cmp-001', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.META,
      actionType: ActionType.INCREASE_BUDGET, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 2600 }, after: { daily_budget_sar: 3000 },
      explanation: { en: 'ROAS reached 4.1x against the 3.0x target across 3 consecutive 24-hour windows. Budget increased by +15.4% from SAR 2,600 to SAR 3,000 to capture additional high-quality conversions.', ar: null },
      createdAt: hoursAgo(0.25), appliedAt: hoursAgo(0.22),
    },
    {
      key: 'act-t02', campaignKey: 'cmp-003', adSetKey: 'ads-003a', entityType: 'AD_SET', platform: Platform.META,
      actionType: ActionType.ADJUST_BID_CEILING, status: ActionStatus.PENDING, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bid_ceiling_sar: 12.0 }, after: { bid_ceiling_sar: 15.0 },
      explanation: { en: 'Spend pacing at 99% with ROAS 5.6x — the ad set is delivery-constrained, not budget-constrained. Raising the bid ceiling from SAR 12.00 to SAR 15.00 should unlock additional impression volume at this ROAS level.', ar: null },
      createdAt: hoursAgo(0.6), appliedAt: null,
    },
    {
      key: 'act-t03', campaignKey: 'cmp-002', adSetKey: 'ads-002a', entityType: 'AD_SET', platform: Platform.TIKTOK,
      actionType: ActionType.SWITCH_BIDDING_STRATEGY, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bidding_strategy: 'LOWEST_COST' }, after: { bidding_strategy: 'COST_CAP', cost_cap_sar: 18.0 },
      explanation: { en: 'CPA rose to SAR 14.20 — 18% above the SAR 12.00 target — for 2 consecutive evaluation windows. Switching from Lowest Cost to Cost Cap at SAR 18.00 introduces a spending ceiling to prevent further CPA deterioration.', ar: null },
      createdAt: hoursAgo(3.5), appliedAt: hoursAgo(3.4),
    },
    {
      key: 'act-t04', campaignKey: 'cmp-004', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.GOOGLE_ADS,
      actionType: ActionType.INCREASE_BUDGET, status: ActionStatus.SKIPPED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 2000 }, after: { daily_budget_sar: 2300 },
      explanation: { en: "Campaign is in the LEARNING phase (day 4 of 7). Optimizer interventions are paused until the learning phase completes to avoid disrupting the platform's calibration process. This rule will be re-evaluated automatically.", ar: null },
      createdAt: hoursAgo(5), appliedAt: null,
    },
    {
      key: 'act-t05', campaignKey: 'cmp-001', adSetKey: 'ads-001b', entityType: 'AD_SET', platform: Platform.META,
      actionType: ActionType.ADJUST_BID_FLOOR, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bid_floor_sar: null }, after: { bid_floor_sar: 3.5 },
      explanation: { en: 'This ad set was winning fewer auctions than expected at its current bid range. Setting a SAR 3.50 bid floor prevents the platform from bidding below a viable CPM threshold, which should improve delivery consistency.', ar: null },
      createdAt: hoursAgo(7.1), appliedAt: hoursAgo(7.0),
    },
    // Yesterday
    {
      key: 'act-y01', campaignKey: 'cmp-001', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.META,
      actionType: ActionType.INCREASE_BUDGET, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 2300 }, after: { daily_budget_sar: 2600 },
      explanation: { en: 'ROAS maintained above 3.8x for 3 consecutive 24-hour windows with spend pacing at 94%. Budget scaled from SAR 2,300 to SAR 2,600 (+13.0%) to continue capturing high-intent conversions at this efficiency.', ar: null },
      createdAt: daysAgo(1, 2), appliedAt: daysAgo(1, 1.9),
    },
    {
      key: 'act-y02', campaignKey: 'cmp-005', adSetKey: 'ads-005a', entityType: 'AD_SET', platform: Platform.SNAPCHAT,
      actionType: ActionType.DECREASE_BUDGET, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 300 }, after: { daily_budget_sar: 180 },
      explanation: { en: 'ROAS fell to 0.8x — below the 1.0x unprofitability threshold — for 3 consecutive windows. Daily budget reduced by 40% from SAR 300 to SAR 180 to limit losses while a root-cause review is performed.', ar: null },
      createdAt: daysAgo(1, 4), appliedAt: daysAgo(1, 3.9),
    },
    {
      key: 'act-y03', campaignKey: 'cmp-003', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.META,
      actionType: ActionType.INCREASE_BUDGET, status: ActionStatus.FAILED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 700 }, after: { daily_budget_sar: 800 },
      explanation: { en: 'ROAS at 5.2x with 96% pacing — budget increase recommended. However, the Meta API returned an account-level error preventing the update. No budget change was made. The system will retry on the next cycle.', ar: null },
      errorMessage: 'Meta API error: (#200) Requires ads_management permission — token may need re-authorization.',
      createdAt: daysAgo(1, 6), appliedAt: null,
    },
    {
      key: 'act-y04', campaignKey: 'cmp-002', adSetKey: 'ads-002b', entityType: 'AD_SET', platform: Platform.TIKTOK,
      actionType: ActionType.ADJUST_BID_CEILING, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bid_ceiling_sar: 10.0 }, after: { bid_ceiling_sar: 13.0 },
      explanation: { en: "Ad set spent only 61% of its daily budget with 0 delivery issues flagged. The bid ceiling of SAR 10.00 was too restrictive — TikTok's auction clearing price exceeded it in most slots. Ceiling raised to SAR 13.00 to increase auction win rate.", ar: null },
      createdAt: daysAgo(1, 9), appliedAt: daysAgo(1, 8.9),
    },
    {
      key: 'act-y05', campaignKey: 'cmp-004', adSetKey: 'ads-004a', entityType: 'AD_SET', platform: Platform.GOOGLE_ADS,
      actionType: ActionType.SWITCH_BIDDING_STRATEGY, status: ActionStatus.ROLLED_BACK, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bidding_strategy: 'TARGET_CPA', target_cpa_sar: 20.0 }, after: { bidding_strategy: 'LOWEST_COST' },
      explanation: { en: 'Switched from Target CPA to Lowest Cost to capture more volume during a period of high search intent. The change resulted in CPA spiking 80% within 4 hours — above the emergency rollback threshold. Strategy was reverted automatically.', ar: null },
      createdAt: daysAgo(1, 12), appliedAt: daysAgo(1, 11.5),
    },
    // 2 days ago
    {
      key: 'act-2d01', campaignKey: 'cmp-001', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.META,
      actionType: ActionType.INCREASE_BUDGET, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.MANUAL,
      before: { daily_budget_sar: 2000 }, after: { daily_budget_sar: 2300 },
      explanation: { en: 'Manual budget increase triggered by account manager. Campaign showed ROAS 3.9x with strong conversion volume. Budget raised from SAR 2,000 to SAR 2,300 ahead of peak Ramadan traffic hours.', ar: null },
      createdAt: daysAgo(2, 3), appliedAt: daysAgo(2, 2.9),
    },
    {
      key: 'act-2d02', campaignKey: 'cmp-005', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.SNAPCHAT,
      actionType: ActionType.DECREASE_BUDGET, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 600 }, after: { daily_budget_sar: 300 },
      explanation: { en: 'CPA reached SAR 38.90 — 77% above the SAR 22.00 target — for 3 consecutive evaluation windows. Budget halved from SAR 600 to SAR 300 to reduce losses while the campaign is under review.', ar: null },
      createdAt: daysAgo(2, 6), appliedAt: daysAgo(2, 5.9),
    },
    {
      key: 'act-2d03', campaignKey: 'cmp-002', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.TIKTOK,
      actionType: ActionType.INCREASE_BUDGET, status: ActionStatus.SKIPPED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 1500 }, after: { daily_budget_sar: 1725 },
      explanation: { en: 'Budget increase was proposed based on strong ROAS, but a cooldown is active from the strategy change applied 18 hours earlier. No action taken — the cooldown window is 24 hours. This rule will be re-evaluated in the next cycle.', ar: null },
      createdAt: daysAgo(2, 9), appliedAt: null,
    },
    {
      key: 'act-2d04', campaignKey: 'cmp-003', adSetKey: 'ads-003a', entityType: 'AD_SET', platform: Platform.META,
      actionType: ActionType.ADJUST_BID_FLOOR, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bid_floor_sar: 5.0 }, after: { bid_floor_sar: null },
      explanation: { en: 'Bid floor of SAR 5.00 was preventing this ad set from competing in lower-CPM inventory slots where conversion rates are strong. Removing the floor expands the accessible auction pool and should improve spend efficiency.', ar: null },
      createdAt: daysAgo(2, 14), appliedAt: daysAgo(2, 13.9),
    },
    // 3 days ago
    {
      key: 'act-3d01', campaignKey: 'cmp-001', adSetKey: 'ads-001a', entityType: 'AD_SET', platform: Platform.META,
      actionType: ActionType.SWITCH_BIDDING_STRATEGY, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { bidding_strategy: 'COST_CAP', cost_cap_sar: 15.0 }, after: { bidding_strategy: 'LOWEST_COST' },
      explanation: { en: 'ROAS sustained above 4.0x for 3 consecutive windows while Cost Cap was active. Removing the cap and switching to Lowest Cost gives the platform more flexibility to bid aggressively on high-intent users.', ar: null },
      createdAt: daysAgo(3, 4), appliedAt: daysAgo(3, 3.9),
    },
    {
      key: 'act-3d02', campaignKey: 'cmp-004', adSetKey: null, entityType: 'CAMPAIGN', platform: Platform.GOOGLE_ADS,
      actionType: ActionType.DECREASE_BUDGET, status: ActionStatus.APPLIED, triggeredBy: TriggeredBy.SCHEDULER,
      before: { daily_budget_sar: 2500 }, after: { daily_budget_sar: 2000 },
      explanation: { en: "CTR dropped to 1.4% — below the 2.0% threshold — for 2 consecutive windows, suggesting keyword-audience alignment issues. Budget reduced by 20% to SAR 2,000 to limit wasted spend while the keyword list is reviewed.", ar: null },
      createdAt: daysAgo(3, 8), appliedAt: daysAgo(3, 7.9),
    },
  ];

  for (const action of ACTIONS) {
    const entityId = action.adSetKey
      ? adSetIdMap[action.adSetKey]
      : campaignIdMap[action.campaignKey];

    const existing = await prisma.optimizerAction.findFirst({ where: { orgId: org.id, entityId, createdAt: action.createdAt } });
    if (!existing) {
      await prisma.optimizerAction.create({
        data: {
          orgId: org.id,
          entityType: action.entityType,
          entityId,
          platform: action.platform,
          actionType: action.actionType,
          beforeValue: action.before as Prisma.InputJsonValue,
          afterValue: action.after as Prisma.InputJsonValue,
          status: action.status,
          triggeredBy: action.triggeredBy,
          appliedAt: action.appliedAt,
          errorMessage: action.errorMessage ?? null,
          explanation: action.explanation as Prisma.InputJsonValue,
          createdAt: action.createdAt,
        },
      });
    }
  }
  console.log(`  ✔ Optimizer actions: ${ACTIONS.length} created`);

  // ── Alerts ────────────────────────────────────────────────────────────────
  const ALERTS: Array<{
    entityId: string;
    entityType: string;
    alertType: AlertType;
    severity: AlertSeverity;
    message: string;
    isRead: boolean;
    dedupKey: string;
    createdAt: Date;
  }> = [
    {
      entityId: campaignIdMap['cmp-001'], entityType: 'CAMPAIGN',
      alertType: AlertType.BUDGET_EXHAUSTED, severity: AlertSeverity.CRITICAL,
      message: 'Daily budget fully spent with 6 hours remaining in the day. No further delivery until tomorrow.',
      isRead: false, dedupKey: `${org.id}:CAMPAIGN:${campaignIdMap['cmp-001']}:BUDGET_EXHAUSTED`,
      createdAt: hoursAgo(0.42),
    },
    {
      entityId: campaignIdMap['cmp-005'], entityType: 'CAMPAIGN',
      alertType: AlertType.HIGH_CPA, severity: AlertSeverity.WARNING,
      message: 'CPA exceeded target by 78% (SAR 38.90 vs target SAR 22.00) for 2 consecutive windows.',
      isRead: false, dedupKey: `${org.id}:CAMPAIGN:${campaignIdMap['cmp-005']}:HIGH_CPA`,
      createdAt: hoursAgo(3),
    },
    {
      entityId: campaignIdMap['cmp-004'], entityType: 'CAMPAIGN',
      alertType: AlertType.LEARNING_STALLED, severity: AlertSeverity.WARNING,
      message: 'Campaign has been in LEARNING phase for 9 days with insufficient conversion volume.',
      isRead: true, dedupKey: `${org.id}:CAMPAIGN:${campaignIdMap['cmp-004']}:LEARNING_STALLED`,
      createdAt: hoursAgo(6),
    },
    {
      entityId: campaignIdMap['cmp-005'], entityType: 'CAMPAIGN',
      alertType: AlertType.LOW_ROAS, severity: AlertSeverity.INFO,
      message: 'ROAS dropped below 1.0x threshold. Campaign is currently unprofitable.',
      isRead: true, dedupKey: `${org.id}:CAMPAIGN:${campaignIdMap['cmp-005']}:LOW_ROAS`,
      createdAt: hoursAgo(10),
    },
  ];

  for (const alert of ALERTS) {
    const existing = await prisma.alert.findFirst({ where: { dedupKey: alert.dedupKey } });
    if (!existing) {
      await prisma.alert.create({
        data: {
          orgId: org.id,
          entityType: alert.entityType,
          entityId: alert.entityId,
          alertType: alert.alertType,
          severity: alert.severity,
          message: alert.message,
          isRead: alert.isRead,
          dedupKey: alert.dedupKey,
          routedVia: ['in_app'],
          createdAt: alert.createdAt,
        },
      });
    }
  }
  console.log(`  ✔ Alerts: ${ALERTS.length} created`);

  // ── Global AdminSettings ──────────────────────────────────────────────────
  const SETTINGS: Array<{ key: string; value: unknown; description: string }> = [
    { key: 'optimizer.enabled',                 value: true,          description: 'Enable/disable the optimizer globally' },
    { key: 'optimizer.cooldown_hours',           value: 24,            description: 'Minimum hours between actions on the same entity+action_type' },
    { key: 'optimizer.max_budget_increase_pct',  value: 30,            description: 'Maximum percentage budget increase per cycle' },
    { key: 'optimizer.max_budget_decrease_pct',  value: 20,            description: 'Maximum percentage budget decrease per cycle' },
    { key: 'optimizer.min_sample_impressions',   value: 500,           description: 'Minimum impressions required before evaluating rules' },
    { key: 'optimizer.cycle_interval_minutes',   value: 60,            description: 'How often the optimizer cycle runs (minutes)' },
    { key: 'optimizer.default_mode',             value: 'SUGGEST_ONLY', description: 'Default optimizer mode for new campaigns' },
  ];

  // Prisma cannot target a compound unique where clause with a null column,
  // so upsert on orgId=null is unsupported. Fall back to findFirst + create
  // to keep the seed idempotent for the global (orgId=null) row.
  for (const s of SETTINGS) {
    const existing = await prisma.adminSetting.findFirst({
      where: { orgId: null, key: s.key },
    });
    if (!existing) {
      await prisma.adminSetting.create({
        data: {
          orgId: null,
          key: s.key,
          value: s.value as Prisma.InputJsonValue,
          description: s.description,
          isPublic: false,
        },
      });
    }
  }
  console.log(`  ✔ AdminSettings: ${SETTINGS.length} global defaults created`);

  console.log('\n✅ Seed complete.');
  console.log(`   Login: admin@nsaq.io / Password123!`);
  console.log(`   Org ID: ${org.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
