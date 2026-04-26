'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { Button, buttonStyles } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FullPageSpinner, Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import { ApiError } from '@/lib/api/client';
import { formatCurrency } from '@/lib/utils/format';
import { campaignArchitectApi } from '../api/client';
import { getPlanName, type LaunchResult, type PlanResponse } from '../api/types';

interface LaunchPageProps {
  planId: string;
}

const LAUNCHABLE_STATUSES = new Set<PlanResponse['status']>(['APPROVED', 'LAUNCHING']);

export function LaunchPage({ planId }: LaunchPageProps) {
  const t = useTranslations('campaignArchitect');
  const locale = useLocale();
  const router = useRouter();
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [conflictNotice, setConflictNotice] = useState(false);

  const planQuery = useQuery({
    queryKey: ['campaign-plan', orgId, planId],
    queryFn: () => campaignArchitectApi.getPlan(orgId, planId),
    enabled: !!orgId && !!planId,
  });

  const launchMutation = useMutation({
    mutationFn: () => campaignArchitectApi.launchPlan(orgId, planId),
    onSuccess: (result: LaunchResult) => {
      queryClient.setQueryData(['campaign-launch-result', orgId, planId], result);
      queryClient.invalidateQueries({ queryKey: ['campaign-plan', orgId, planId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-plans', orgId] });
      router.replace(`/campaign-architect/${planId}/launched`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        setConflictNotice(true);
        planQuery.refetch();
      }
    },
  });

  if (planQuery.isLoading) return <FullPageSpinner />;

  if (planQuery.isError) {
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

  const plan = planQuery.data;
  if (!plan) return null;

  const isLaunchable = LAUNCHABLE_STATUSES.has(plan.status);
  const isRunning = launchMutation.isPending;
  const apiError = launchMutation.error instanceof ApiError ? launchMutation.error : null;
  const isConflict = conflictNotice || apiError?.status === 409;
  const showGenericError = apiError !== null && apiError.status !== 409;

  // Already launched? Send straight to results.
  if (plan.status === 'LAUNCHED') {
    return (
      <PageContainer className="gap-5">
        <Card>
          <div className="px-6 py-5 text-sm">
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {t('launched_title')}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('launched_subtitle_full')}
            </p>
            <div className="mt-3 flex gap-2">
              <Link href={`/campaign-architect/${planId}/launched`} className={buttonStyles()}>
                {t('launched_back_to_plan')}
              </Link>
              <Link href="/campaigns" className={buttonStyles({ variant: 'outline' })}>
                {t('launched_back_to_campaigns')}
              </Link>
            </div>
          </div>
        </Card>
      </PageContainer>
    );
  }

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
          {t('plan_back_to_list')}
        </Link>

        <PageHeader
          title={t('launch_page_title')}
          subtitle={getPlanName(plan)}
          actions={
            <Badge variant={plan.status === 'APPROVED' ? 'success' : 'info'}>
              {t(`status_${plan.status.toLowerCase()}` as Parameters<typeof t>[0])}
            </Badge>
          }
        />
      </div>

      {isConflict && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/15">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {t('launch_conflict_title')}
            </p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t('launch_conflict_desc')}
            </p>
            <div className="mt-3">
              <Link href={`/campaign-architect/${planId}`} className={buttonStyles({ variant: 'outline', size: 'sm' })}>
                {t('plan_back_to_list')}
              </Link>
            </div>
          </div>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-900/10">
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <svg className="h-4 w-4 text-amber-700 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {t('launch_paused_note_title')}
            </p>
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              {t('launch_paused_note_desc')}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t('plan_items')}
          </h3>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {plan.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-6 py-3">
              <div className="flex items-center gap-2">
                <PlatformBadge platform={item.platform} />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {item.objective}
                </span>
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                <bdi>{formatCurrency(item.dailyBudget, locale, plan.currency)}</bdi>
                <span className="ms-1 text-xs font-normal text-slate-400">
                  {t('plan_impact_per_day')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {isRunning && (
        <Card>
          <div className="flex items-center gap-3 px-5 py-4">
            <Spinner size="sm" />
            <div className="flex flex-col">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {t('launch_running_title')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('launch_running_desc')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {showGenericError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/10">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">
              {t('launch_error_title')}
            </p>
            {apiError?.message && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{apiError.message}</p>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          disabled={isRunning}
          onClick={() => router.push(`/campaign-architect/${planId}`)}
        >
          {t('launch_cancel')}
        </Button>
        <Button
          onClick={() => launchMutation.mutate()}
          disabled={!isLaunchable || isConflict || isRunning}
          loading={isRunning}
        >
          {t('launch_button')}
        </Button>
      </div>
    </PageContainer>
  );
}
