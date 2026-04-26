'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonStyles } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import { ApiError } from '@/lib/api/client';
import { campaignArchitectApi } from '../api/client';
import { getPlanName, type CampaignPlanStatus } from '../api/types';
import { StrategicSummaryCard } from '../components/plan/strategic-summary-card';
import { ConfidenceMeter } from '../components/plan/confidence-meter';
import { RisksList } from '../components/plan/risks-list';
import { PlanItemsList } from '../components/plan/plan-items-list';
import { EstimatedImpact } from '../components/plan/estimated-impact';
import { PlanActionBar } from '../components/plan/plan-action-bar';
import { ConfirmModal } from '../components/plan/confirm-modal';

const STATUS_VARIANT: Record<CampaignPlanStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted' | 'info'> = {
  DRAFT: 'muted',
  APPROVED: 'success',
  LAUNCHING: 'info',
  LAUNCHED: 'success',
  FAILED: 'danger',
  ARCHIVED: 'muted',
};

interface PlanReviewPageProps {
  planId: string;
}

export function PlanReviewPage({ planId }: PlanReviewPageProps) {
  const t = useTranslations('campaignArchitect');
  const router = useRouter();
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [regenerateOpen, setRegenerateOpen] = useState(false);

  const { data: plan, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['campaign-plan', orgId, planId],
    queryFn: () => campaignArchitectApi.getPlan(orgId, planId),
    enabled: !!orgId && !!planId,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => campaignArchitectApi.regeneratePlan(orgId, planId),
    onSuccess: (next) => {
      queryClient.setQueryData(['campaign-plan', orgId, planId], next);
      queryClient.invalidateQueries({ queryKey: ['campaign-plans', orgId] });
      setRegenerateOpen(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (acknowledgedWarnings: boolean) =>
      campaignArchitectApi.approvePlan(orgId, planId, acknowledgedWarnings),
    onSuccess: (next) => {
      queryClient.setQueryData(['campaign-plan', orgId, planId], next);
      queryClient.invalidateQueries({ queryKey: ['campaign-plans', orgId] });
    },
  });

  if (isLoading) return <FullPageSpinner />;

  if (isError) {
    if (error instanceof ApiError && error.status === 404) {
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
    return <ErrorState onRetry={() => refetch()} />;
  }

  if (!plan) return null;

  return (
    <PageContainer className="gap-5">
      <div className="flex flex-col gap-3">
        <Link
          href="/campaign-architect"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <svg className="h-3.5 w-3.5 rtl:scale-x-[-1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('plan_back_to_list')}
        </Link>

        <PageHeader
          title={getPlanName(plan)}
          subtitle={t(`goal_${plan.goal}` as Parameters<typeof t>[0])}
          actions={
            <Badge variant={STATUS_VARIANT[plan.status]}>
              {t(`status_${plan.status.toLowerCase()}` as Parameters<typeof t>[0])}
            </Badge>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <StrategicSummaryCard summary={plan.summary} />
          <RisksList risks={plan.risks} />
          <PlanItemsList items={plan.items} currency={plan.currency} />
          <EstimatedImpact plan={plan} />
        </div>
        <div className="flex flex-col gap-5">
          <ConfidenceMeter confidence={plan.summary.confidence} />
        </div>
      </div>

      <PlanActionBar
        plan={plan}
        onRegenerate={() => setRegenerateOpen(true)}
        onApprove={(acknowledgedWarnings) => approveMutation.mutate(acknowledgedWarnings)}
        onLaunch={() => router.push(`/campaign-architect/${planId}/launch`)}
        isRegenerating={regenerateMutation.isPending}
        isApproving={approveMutation.isPending}
      />

      <ConfirmModal
        open={regenerateOpen}
        onClose={() => setRegenerateOpen(false)}
        title={t('regenerate_modal_title')}
        description={t('regenerate_modal_desc')}
        confirmLabel={t('regenerate_modal_confirm')}
        cancelLabel={t('regenerate_modal_cancel')}
        onConfirm={() => regenerateMutation.mutate()}
        loading={regenerateMutation.isPending}
      />
    </PageContainer>
  );
}
