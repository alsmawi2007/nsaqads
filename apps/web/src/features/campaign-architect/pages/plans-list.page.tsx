'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonStyles } from '@/components/ui/button';
import { Table } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { Link } from '@/lib/i18n/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import { formatCurrency, formatRelativeTime } from '@/lib/utils/format';
import { campaignArchitectApi } from '../api/client';
import { getPlanName, type CampaignPlanStatus, type PlanResponse } from '../api/types';
import { ConfidenceMeter } from '../components/plan/confidence-meter';

const STATUS_VARIANT: Record<CampaignPlanStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted' | 'info'> = {
  DRAFT: 'muted',
  APPROVED: 'success',
  LAUNCHING: 'info',
  LAUNCHED: 'success',
  FAILED: 'danger',
  ARCHIVED: 'muted',
};

export function PlansListPage() {
  const t = useTranslations('campaignArchitect');
  const locale = useLocale();
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';

  const { data: plans, isLoading, isError, refetch } = useQuery({
    queryKey: ['campaign-plans', orgId],
    queryFn: () => campaignArchitectApi.listPlans(orgId, { limit: 50 }),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  if (isLoading) return <FullPageSpinner />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const rows = plans ?? [];

  const newPlanCta = (
    <Link href="/campaign-architect/new" className={buttonStyles()}>
      {t('newPlan')}
    </Link>
  );

  return (
    <PageContainer className="gap-5">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={rows.length > 0 ? newPlanCta : undefined}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            }
            title={t('list_empty_title')}
            description={t('list_empty_desc')}
            action={
              <Link href="/campaign-architect/new" className={buttonStyles()}>
                {t('list_empty_cta')}
              </Link>
            }
          />
        </Card>
      ) : (
        <Card>
          <Table<PlanResponse>
            keyExtractor={(p) => p.id}
            data={rows}
            columns={[
              {
                key: 'name',
                header: t('col_name'),
                cell: (p) => (
                  <Link
                    href={`/campaign-architect/${p.id}`}
                    className="font-medium text-slate-900 hover:text-brand-600 dark:text-slate-100 dark:hover:text-brand-400"
                  >
                    {getPlanName(p)}
                  </Link>
                ),
              },
              {
                key: 'goal',
                header: t('col_goal'),
                cell: (p) => (
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    {t(`goal_${p.goal}` as Parameters<typeof t>[0])}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('col_status'),
                cell: (p) => (
                  <Badge variant={STATUS_VARIANT[p.status]}>
                    {t(`status_${p.status.toLowerCase()}` as Parameters<typeof t>[0])}
                  </Badge>
                ),
              },
              {
                key: 'confidence',
                header: t('col_confidence'),
                cell: (p) => <ConfidenceMeter confidence={p.summary.confidence} compact />,
              },
              {
                key: 'platforms',
                header: t('col_platforms'),
                cell: (p) => {
                  const platforms = Array.from(new Set(p.items.map((i) => i.platform)));
                  if (platforms.length === 0) {
                    return <span className="text-xs text-slate-400">—</span>;
                  }
                  return (
                    <div className="flex flex-wrap gap-1">
                      {platforms.map((pl) => (
                        <PlatformBadge key={pl} platform={pl} />
                      ))}
                    </div>
                  );
                },
              },
              {
                key: 'budget',
                header: t('col_budget'),
                cell: (p) => (
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    <bdi>{formatCurrency(p.totalBudget, locale, p.currency)}</bdi>
                  </span>
                ),
              },
              {
                key: 'created',
                header: t('col_created'),
                cell: (p) => (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRelativeTime(p.createdAt, locale)}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
    </PageContainer>
  );
}
