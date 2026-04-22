'use client';

import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/lib/stores/auth.store';
import { alertsApi, type Alert } from '@/lib/api/alerts';
import { formatRelativeTime } from '@/lib/utils/format';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const severityVariant: Record<string, 'danger' | 'warning' | 'info'> = {
  CRITICAL: 'danger',
  WARNING:  'warning',
  INFO:     'info',
};

function AlertRow({ alert, orgId }: { alert: Alert; orgId: string }) {
  const t = useTranslations('alerts');
  const tCommon = useTranslations('common');
  const { locale } = useParams<{ locale: string }>();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: () => alertsApi.markRead(orgId, alert.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts', orgId] }),
  });

  const resolve = useMutation({
    mutationFn: () => alertsApi.resolve(orgId, alert.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts', orgId] }),
  });

  return (
    <div
      className={cn(
        'flex items-start gap-4 px-6 py-4 border-b border-slate-100 last:border-0 dark:border-slate-700/50',
        !alert.isRead && 'bg-brand-50/30 dark:bg-brand-900/5',
      )}
    >
      <div className="shrink-0 pt-0.5">
        <Badge variant={severityVariant[alert.severity] ?? 'info'}>
          {t(`severity_${alert.severity.toLowerCase()}` as Parameters<typeof t>[0])}
        </Badge>
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm text-slate-700 dark:text-slate-300', !alert.isRead && 'font-medium')}>
          {alert.message}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          {t(`type_${alert.alertType.toLowerCase()}` as Parameters<typeof t>[0])} · {formatRelativeTime(alert.createdAt, locale)}
        </p>
        {alert.resolvedAt && (
          <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">{t('resolved')}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!alert.isRead && (
          <Button size="sm" variant="ghost" loading={markRead.isPending} onClick={() => markRead.mutate()}>
            {t('markRead')}
          </Button>
        )}
        {!alert.resolvedAt && (
          <Button size="sm" variant="outline" loading={resolve.isPending} onClick={() => resolve.mutate()}>
            {t('resolve')}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const t = useTranslations('alerts');
  const { activeOrg } = useAuthStore();
  const queryClient = useQueryClient();

  const orgId = activeOrg?.id ?? '';

  const { data: alerts, isLoading, isError, refetch } = useQuery({
    queryKey: ['alerts', orgId],
    queryFn: () => alertsApi.list(orgId),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });

  const markAllRead = useMutation({
    mutationFn: () => alertsApi.markAllRead(orgId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts', orgId] }),
  });

  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  const unreadCount = alerts?.filter((a) => !a.isRead).length ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          unreadCount > 0 ? (
            <Button size="sm" variant="secondary" loading={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
              {t('markAllRead')}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {t('title')}
            {unreadCount > 0 && (
              <span className="ms-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">{unreadCount}</span>
            )}
          </CardTitle>
        </CardHeader>
        {alerts?.length === 0 ? (
          <EmptyState title={t('allClear')} className="py-10" />
        ) : (
          <div>
            {alerts?.map((alert) => (
              <AlertRow key={alert.id} alert={alert} orgId={orgId} />
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
