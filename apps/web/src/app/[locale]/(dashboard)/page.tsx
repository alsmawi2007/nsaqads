'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth.store';
import { dashboardApi } from '@/lib/api/dashboard';
import { PageContainer } from '@/components/layout/page-container';
import { KPISection } from '@/features/dashboard/kpi-section';
import { CampaignOverview } from '@/features/dashboard/campaign-overview';
import { OptimizerSummary } from '@/features/dashboard/optimizer-summary';
import { AlertsWidget } from '@/features/dashboard/alerts-widget';
import {
  MOCK_KPIS,
  MOCK_CAMPAIGNS,
  MOCK_OPTIMIZER_TODAY,
  MOCK_OPTIMIZER_ACTIONS,
  MOCK_ALERTS,
} from '@/features/dashboard/mock-data';

// ─── Refresh button ───────────────────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';

  const { data, refetch } = useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: () => dashboardApi.getSummary(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const kpis = data
    ? {
        totalSpend:       data.kpis.totalSpend,
        totalConversions: data.kpis.totalConversions,
        avgRoas:          data.kpis.avgRoas,
        avgCpa:           data.kpis.avgCpa,
        avgCtr:           data.kpis.avgCtr,
        trends:           data.kpis.trends,
      }
    : MOCK_KPIS;

  const campaigns = data?.campaigns.map((c) => ({ ...c, dailyBudget: c.dailyBudget ?? 0 })) ?? MOCK_CAMPAIGNS;
  const optimizerToday   = data?.optimizerToday   ?? MOCK_OPTIMIZER_TODAY;
  const optimizerActions = data?.recentActions    ?? MOCK_OPTIMIZER_ACTIONS;
  const alerts           = data?.recentAlerts      ?? MOCK_ALERTS;

  return (
    <PageContainer className="gap-5">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t('title')}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {t('overview')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
          title="Refresh data"
        >
          <RefreshIcon />
          {tCommon('refresh')}
        </button>
      </div>

      {/* ── Tier 1: KPI strip ─────────────────────────────────────────── */}
      <KPISection data={kpis} />

      {/* ── Tier 2 + 3: Main grid ─────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">

        {/* Left column — Campaign Overview */}
        <CampaignOverview campaigns={campaigns} />

        {/* Right column — Optimizer Summary + Alerts (stacked) */}
        <div className="flex flex-col gap-5">
          <OptimizerSummary
            today={optimizerToday}
            recentActions={optimizerActions}
          />
          <AlertsWidget alerts={alerts} />
        </div>

      </div>
    </PageContainer>
  );
}
