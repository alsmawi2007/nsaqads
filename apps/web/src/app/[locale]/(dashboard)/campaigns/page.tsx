'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table } from '@/components/ui/table';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { useAuthStore } from '@/lib/stores/auth.store';
import { campaignsApi, budgetSourceLabel, type Campaign } from '@/lib/api/campaigns';
import { formatCurrency, formatRelativeTime } from '@/lib/utils/format';
import { Link } from '@/lib/i18n/navigation';
import type { ReactNode } from 'react';

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

const modeVariant: Record<string, 'success' | 'info' | 'muted'> = {
  AUTO_APPLY:   'success',
  SUGGEST_ONLY: 'info',
  OFF:          'muted',
};

// Maps OptimizerMode enum → campaigns translation key suffix
const MODE_KEY_MAP: Record<string, 'mode_auto' | 'mode_suggest' | 'mode_off'> = {
  AUTO_APPLY:   'mode_auto',
  SUGGEST_ONLY: 'mode_suggest',
  OFF:          'mode_off',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const t       = useTranslations('campaigns');
  const tCommon = useTranslations('common');
  const { locale } = useParams<{ locale: string }>();
  const { activeOrg } = useAuthStore();

  const { data: campaigns, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaigns', activeOrg?.id],
    queryFn:  () => campaignsApi.list(activeOrg!.id),
    enabled:  !!activeOrg?.id,
  });

  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  const columns: { key: string; header: ReactNode; cell: (row: Campaign) => ReactNode; className?: string }[] = [
    {
      key: 'name',
      header: t('campaignName'),
      cell: (row) => (
        <Link href={`/campaigns/${row.id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'platform',
      header: t('adAccount'),
      cell: (row) => <PlatformBadge platform={row.platform} />,
    },
    {
      key: 'dailyBudget',
      header: t('dailyBudget'),
      cell: (row) => {
        // Snap/TikTok/Google often expose budgets at the ad-set level; the
        // campaign row's daily_budget is null there. Show where the budget
        // actually lives so the user doesn't think the data is missing.
        const source = budgetSourceLabel(row);
        if (source === 'campaign-daily' && row.dailyBudget) {
          return formatCurrency(row.dailyBudget, locale, 'SAR');
        }
        if (source === 'campaign-lifetime' && row.lifetimeBudget) {
          return (
            <span title={t('budgetSource_campaign-lifetime')}>
              {formatCurrency(row.lifetimeBudget, locale, 'SAR')}
              <span className="ms-1 text-[10px] uppercase tracking-wider text-slate-400">{t('budgetSource_lifetime_tag')}</span>
            </span>
          );
        }
        return (
          <span className="text-xs text-slate-400 dark:text-slate-500" title={t(`budgetSource_${source}` as Parameters<typeof t>[0])}>
            {t(`budgetSource_${source}` as Parameters<typeof t>[0])}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('status'),
      cell: (row) => (
        <Badge variant={statusVariant[row.status] ?? 'muted'}>
          {t(`status_${row.status.toLowerCase()}` as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      key: 'phase',
      header: t('phase'),
      cell: (row) => (
        <Badge variant={phaseVariant[row.campaignPhase] ?? 'muted'}>
          {t(`phase_${row.campaignPhase.toLowerCase()}` as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      key: 'mode',
      header: t('optimizerMode'),
      cell: (row) => (
        <Badge variant={modeVariant[row.optimizerMode] ?? 'muted'}>
          {t((MODE_KEY_MAP[row.optimizerMode] ?? 'mode_off') as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      key: 'syncedAt',
      header: t('lastSync'),
      cell: (row) => (
        <span className="text-xs text-slate-400">
          {row.syncedAt ? formatRelativeTime(row.syncedAt, locale) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <Link href={`/campaigns/${row.id}`} className="text-xs text-brand-600 hover:underline dark:text-brand-400">
          {t('viewDetails')}
        </Link>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Card>
        <Table
          columns={columns}
          data={campaigns ?? []}
          keyExtractor={(row) => row.id}
          emptyState={<span className="text-sm text-slate-400">{tCommon('noData')}</span>}
        />
      </Card>
    </PageContainer>
  );
}
