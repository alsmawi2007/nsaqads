'use client';

import { useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonStyles } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { Link } from '@/lib/i18n/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';
import { formatDateTime } from '@/lib/utils/format';
import { campaignArchitectApi } from '../api/client';
import {
  getPlanName,
  type LaunchResult,
  type LaunchResultItem,
  type LaunchStatus,
  type PlanItem,
  type PlanResponse,
} from '../api/types';

interface LaunchedPageProps {
  planId: string;
}

const STATUS_VARIANT: Record<LaunchStatus, 'success' | 'danger' | 'muted' | 'info'> = {
  CREATED: 'success',
  FAILED: 'danger',
  SKIPPED: 'muted',
  PENDING: 'info',
  CREATING: 'info',
};

const STATUS_BORDER: Record<LaunchStatus, string> = {
  CREATED: 'border-emerald-200 dark:border-emerald-700/50',
  FAILED: 'border-red-200 dark:border-red-700/50',
  SKIPPED: 'border-slate-200 dark:border-slate-700',
  PENDING: 'border-blue-200 dark:border-blue-700/50',
  CREATING: 'border-blue-200 dark:border-blue-700/50',
};

// Build a synthetic LaunchResult from plan items if no cached result is available
// (e.g. user landed here via direct URL or page refresh).
function deriveResultFromPlan(plan: PlanResponse): LaunchResult {
  const items: LaunchResultItem[] = plan.items.map((i: PlanItem) => ({
    itemId: i.id,
    platform: i.platform,
    launchStatus: i.launchStatus,
    externalCampaignId: i.externalCampaignId,
    externalAdsetIds: i.externalAdsetIds,
    externalCreativeId: null,
    externalAdId: null,
    errorMessage: i.errorMessage,
    launchedAt: i.launchedAt,
  }));

  let createdCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const it of items) {
    if (it.launchStatus === 'CREATED') createdCount++;
    else if (it.launchStatus === 'FAILED') failedCount++;
    else if (it.launchStatus === 'SKIPPED') skippedCount++;
  }
  const total = items.length;
  const processed = createdCount + failedCount + skippedCount;

  return {
    planId: plan.id,
    planStatus: plan.status,
    launchedAt: plan.launchedAt,
    totalItems: total,
    createdCount,
    failedCount,
    skippedCount,
    summary: {
      progressPct: total === 0 ? 0 : Math.round((processed / total) * 100),
      successRate: total === 0 ? 0 : Math.round((createdCount / total) * 100),
      durationMs: 0,
      message: '',
    },
    items,
  };
}

function formatDuration(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function LaunchedPage({ planId }: LaunchedPageProps) {
  const t = useTranslations('campaignArchitect');
  const locale = useLocale();
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';
  const queryClient = useQueryClient();

  const cachedResult = queryClient.getQueryData<LaunchResult>([
    'campaign-launch-result',
    orgId,
    planId,
  ]);

  // Always fetch the plan — used both as a fallback for the result view
  // and for the page subtitle (plan name).
  const planQuery = useQuery({
    queryKey: ['campaign-plan', orgId, planId],
    queryFn: () => campaignArchitectApi.getPlan(orgId, planId),
    enabled: !!orgId && !!planId,
  });

  const result = useMemo<LaunchResult | null>(() => {
    if (cachedResult) return cachedResult;
    if (planQuery.data) return deriveResultFromPlan(planQuery.data);
    return null;
  }, [cachedResult, planQuery.data]);

  if (planQuery.isLoading && !cachedResult) return <FullPageSpinner />;

  if (planQuery.isError && !cachedResult) {
    if (planQuery.error instanceof ApiError && planQuery.error.status === 404) {
      return (
        <PageContainer className="gap-5">
          <Card>
            <EmptyState
              title={t('plan_not_found_title')}
              description={t('plan_not_found_desc')}
              action={
                <Link href="/campaign-architect" className={buttonStyles({ variant: 'outline' })}>
                  {t('plan_back_to_list')}
                </Link>
              }
            />
          </Card>
        </PageContainer>
      );
    }
    return <ErrorState onRetry={() => planQuery.refetch()} />;
  }

  if (!result) return null;

  const planName = planQuery.data ? getPlanName(planQuery.data) : '';
  const allFailed = result.totalItems > 0 && result.createdCount === 0 && result.failedCount > 0;
  const partial = result.failedCount > 0 && result.createdCount > 0;
  const subtitleKey = allFailed
    ? 'launched_subtitle_failed'
    : partial
      ? 'launched_subtitle_partial'
      : 'launched_subtitle_full';

  const headerVariant = allFailed
    ? 'danger'
    : partial
      ? 'warning'
      : 'success';

  const headerVariantClass: Record<typeof headerVariant, string> = {
    success: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-700/50 dark:bg-emerald-900/10',
    warning: 'border-amber-200 bg-amber-50/70 dark:border-amber-700/50 dark:bg-amber-900/10',
    danger: 'border-red-200 bg-red-50/70 dark:border-red-700/50 dark:bg-red-900/10',
  };

  return (
    <PageContainer className="gap-5">
      <div className="flex flex-col gap-3">
        <Link
          href={`/campaign-architect/${planId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <svg className="h-3.5 w-3.5 rtl:scale-x-[-1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('launched_back_to_plan')}
        </Link>

        <PageHeader
          title={t('launched_title')}
          subtitle={planName ? `${planName} — ${t(subtitleKey)}` : t(subtitleKey)}
          actions={
            <Link href="/campaigns" className={buttonStyles()}>
              {t('launched_back_to_campaigns')}
            </Link>
          }
        />
      </div>

      <Card className={cn('border', headerVariantClass[headerVariant])}>
        <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-700 sm:grid-cols-4">
          <SummaryCell label={t('launched_summary_total')} value={String(result.totalItems)} />
          <SummaryCell
            label={t('launched_summary_created')}
            value={String(result.createdCount)}
            tone="success"
          />
          <SummaryCell
            label={t('launched_summary_failed')}
            value={String(result.failedCount)}
            tone={result.failedCount > 0 ? 'danger' : undefined}
          />
          <SummaryCell
            label={t('launched_summary_skipped')}
            value={String(result.skippedCount)}
            tone={result.skippedCount > 0 ? 'muted' : undefined}
          />
        </div>
        {(result.summary.message || result.summary.durationMs > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-slate-600 dark:text-slate-400">
            <span>{result.summary.message}</span>
            {result.summary.durationMs > 0 && (
              <span>
                {t('launched_summary_duration')}:{' '}
                <bdi>{formatDuration(result.summary.durationMs)}</bdi>
              </span>
            )}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-3">
        {result.items.map((item) => (
          <Card key={item.itemId} className={cn('border', STATUS_BORDER[item.launchStatus])}>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-2">
                <PlatformBadge platform={item.platform} />
                <Badge variant={STATUS_VARIANT[item.launchStatus]}>
                  {t(`launch_status_${item.launchStatus}` as Parameters<typeof t>[0])}
                </Badge>
              </div>
              {item.launchedAt && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('launch_item_launched_at')}:{' '}
                  <bdi>{formatDateTime(item.launchedAt, locale)}</bdi>
                </span>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-700/50">
              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('launch_item_external_campaign')}
                  </dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-700 dark:text-slate-200">
                    <bdi>{item.externalCampaignId ?? t('launch_item_no_ids')}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('launch_item_external_adsets')}
                  </dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-700 dark:text-slate-200">
                    {item.externalAdsetIds && item.externalAdsetIds.length > 0 ? (
                      <bdi>{item.externalAdsetIds.join(', ')}</bdi>
                    ) : (
                      t('launch_item_no_ids')
                    )}
                  </dd>
                </div>
              </dl>

              {item.errorMessage && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-700/50 dark:bg-red-900/10">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                    {t('launch_item_error')}
                  </p>
                  <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                    {item.errorMessage}
                  </p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'muted';
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'danger'
        ? 'text-red-700 dark:text-red-400'
        : tone === 'muted'
          ? 'text-slate-500 dark:text-slate-400'
          : 'text-slate-900 dark:text-slate-100';

  return (
    <div className="flex flex-col gap-1 bg-white px-4 py-4 dark:bg-slate-800">
      <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span className={cn('text-base font-semibold', valueClass)}>
        <bdi>{value}</bdi>
      </span>
    </div>
  );
}
