'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { KPICard } from '@/components/shared/kpi-card';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { useAuthStore } from '@/lib/stores/auth.store';
import { campaignsApi } from '@/lib/api/campaigns';
import { formatCurrency, formatNumber, formatPercent, formatRoas } from '@/lib/utils/format';
import { Link } from '@/lib/i18n/navigation';

// ─── Badge variant maps ───────────────────────────────────────────────────────

const statusVariant: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  ACTIVE:   'success',
  PAUSED:   'warning',
  ARCHIVED: 'muted',
  DELETED:  'danger',
};

const phaseVariant: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'muted'> = {
  LEARNING:  'info',
  STABLE:    'success',
  SCALING:   'warning',
  DEGRADED:  'danger',
};

// Maps raw bidding strategy enum → optimizer translation key
const STRATEGY_KEY_MAP: Record<string, string> = {
  LOWEST_COST:  'strategy_LOWEST_COST',
  COST_CAP:     'strategy_COST_CAP',
  BID_CAP:      'strategy_BID_CAP',
  TARGET_CPA:   'strategy_TARGET_CPA',
  TARGET_ROAS:  'strategy_TARGET_ROAS',
};

// ─── Inline section error ─────────────────────────────────────────────────────

function SectionError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      {message}
    </p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const t       = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const tOpt    = useTranslations('optimizer');
  const { locale, id } = useParams<{ locale: string; id: string }>();
  const { activeOrg } = useAuthStore();

  const { data: campaign, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaign', activeOrg?.id, id],
    queryFn:  () => campaignsApi.get(activeOrg!.id, id),
    enabled:  !!activeOrg?.id,
  });

  const { data: metrics, isError: metricsError } = useQuery({
    queryKey: ['campaign-metrics', activeOrg?.id, id, 24],
    queryFn:  () => campaignsApi.getMetrics(activeOrg!.id, id, 24),
    enabled:  !!activeOrg?.id && !!campaign,
  });

  const { data: adSets, isError: adSetsError } = useQuery({
    queryKey: ['ad-sets', activeOrg?.id, id],
    queryFn:  () => campaignsApi.listAdSets(activeOrg!.id, id),
    enabled:  !!activeOrg?.id && !!campaign,
  });

  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;
  if (!campaign) return <ErrorState />;

  const m = metrics;

  return (
    <PageContainer>
      <PageHeader
        title={campaign.name}
        subtitle={undefined}
        actions={
          <div className="flex items-center gap-2">
            <PlatformBadge platform={campaign.platform} />
            <Badge variant={statusVariant[campaign.status] ?? 'muted'}>
              {t(`status_${campaign.status.toLowerCase()}` as Parameters<typeof t>[0])}
            </Badge>
            <Badge variant={phaseVariant[campaign.campaignPhase] ?? 'muted'}>
              {t(`phase_${campaign.campaignPhase.toLowerCase()}` as Parameters<typeof t>[0])}
            </Badge>
          </div>
        }
      />

      {/* ── Metrics KPIs ──────────────────────────────────────────────────── */}
      {metricsError ? (
        <SectionError message={tCommon('error')} />
      ) : m ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KPICard title={t('spend')}       value={formatCurrency(m.spend,       locale, 'SAR')} />
          <KPICard title={t('impressions')} value={formatNumber(m.impressions,   locale)} />
          <KPICard title={t('roas')}        value={formatRoas(m.roas)} />
          <KPICard title={t('cpa')}         value={formatCurrency(m.cpa,         locale, 'SAR')} />
          <KPICard title={t('clicks')}      value={formatNumber(m.clicks,        locale)} />
          <KPICard title={t('ctr')}         value={formatPercent(m.ctr,          locale)} />
        </div>
      ) : null}

      {/* ── Ad Sets ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('adSets')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {adSetsError ? (
            <div className="px-6 py-4">
              <SectionError message={tCommon('error')} />
            </div>
          ) : adSets?.length === 0 ? (
            <p className="px-6 py-4 text-sm text-slate-400">{t('noAdSets')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {adSets?.map((adSet) => {
                const stratKey    = adSet.biddingStrategy ? STRATEGY_KEY_MAP[adSet.biddingStrategy] : undefined;
                const stratLabel  = stratKey
                  ? tOpt(stratKey as Parameters<typeof tOpt>[0])
                  : (adSet.biddingStrategy ?? '—');

                return (
                  <li key={adSet.id} className="flex items-center gap-4 px-6 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                        {adSet.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {stratLabel} · {adSet.dailyBudget ? formatCurrency(adSet.dailyBudget, locale, 'SAR') : '—'}
                      </p>
                    </div>
                    <Badge variant={statusVariant[adSet.status] ?? 'muted'}>
                      {t(`status_${adSet.status.toLowerCase()}` as Parameters<typeof t>[0])}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Back link (direction-aware) ───────────────────────────────────── */}
      <div className="flex">
        <Link
          href="/campaigns"
          className="flex items-center gap-1 text-sm text-brand-600 hover:underline dark:text-brand-400"
        >
          <svg
            className="h-4 w-4 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
          {tCommon('back')}
        </Link>
      </div>
    </PageContainer>
  );
}
