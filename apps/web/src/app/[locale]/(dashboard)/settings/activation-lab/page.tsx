'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/lib/i18n/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  activationLabApi,
  type ChecklistItem,
  type ChecklistStatus,
  type IngestionRunResult,
} from '@/lib/api/activation-lab';
import { PLATFORM_META } from '@/features/provider-configs/platform-meta';

export default function ActivationLabPage() {
  const t = useTranslations('activationLab');
  const { user, activeOrg } = useAuthStore();
  const qc = useQueryClient();
  const orgId = activeOrg?.id;
  const isAdmin = activeOrg?.role === 'OWNER' || activeOrg?.role === 'ADMIN';

  const [lastRun, setLastRun] = useState<IngestionRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['activation-lab', orgId],
    queryFn:  () => activationLabApi.getStatus(orgId!),
    enabled:  !!orgId,
    refetchInterval: 15_000,
  });

  const runIngestion = useMutation({
    mutationFn: () => activationLabApi.runIngestion(orgId!),
    onSuccess: (res) => {
      setLastRun(res);
      setRunError(null);
      qc.invalidateQueries({ queryKey: ['activation-lab', orgId] });
    },
    onError: (err: { message?: string }) => {
      setRunError(err.message ?? 'ingestion_failed');
    },
  });

  if (!user || !activeOrg) return <FullPageSpinner />;
  if (isLoading)            return <FullPageSpinner />;
  if (isError || !data)     return <ErrorState onRetry={() => refetch()} />;

  return (
    <PageContainer className="max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t('subtitle', { org: activeOrg.name })}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} loading={isLoading}>
          {t('refresh')}
        </Button>
      </header>

      {/* Ready checklist */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{t('checklist.title')}</h2>
        <ul className="flex flex-col gap-2">
          {(['providerConnected','adAccountTracked','campaignsSynced','activeCampaigns','campaignPhaseEligible','metricSnapshotsAvailable','optimizerRulesAvailable','autoApplyDisabled'] as const).map((k) => (
            <ChecklistRow key={k} label={t(`checklist.items.${k}`)} item={data.ready[k]} />
          ))}
        </ul>
      </section>

      {/* Action panel: Run ingestion */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('ingestion.title')}</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('ingestion.body')}</p>
            {data.ingestion.lastRunAt && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('ingestion.lastRun', {
                  when: new Date(data.ingestion.lastRunAt).toLocaleString(),
                  summary: data.ingestion.lastRunSummary ?? '—',
                })}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('ingestion.snapshots', { count: data.ingestion.snapshotsLast24h })}
            </p>
          </div>
          {isAdmin ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setRunError(null); runIngestion.mutate(); }}
              loading={runIngestion.isPending}
            >
              {t('ingestion.runNow')}
            </Button>
          ) : (
            <Badge variant="muted">{t('adminOnly')}</Badge>
          )}
        </div>
        {runError && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {runError}
          </p>
        )}
        {lastRun && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
            <p className="font-semibold">{t('ingestion.lastRunHeading')}</p>
            <p className="mt-0.5">
              {t('ingestion.lastRunDetail', {
                ok:       lastRun.successCount,
                failed:   lastRun.failedCount,
                skipped:  lastRun.skippedCount,
                duration: lastRun.durationMs,
              })}
            </p>
          </div>
        )}
      </section>

      {/* Status grid */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatusCard title={t('cards.providers')}>
          <ul className="flex flex-col gap-1.5 text-xs">
            {data.providers.map((p) => {
              const meta = PLATFORM_META[p.platform];
              const variant: 'success' | 'warning' | 'muted' = p.isConfigured && p.isEnabled
                ? 'success'
                : p.isConfigured
                ? 'warning'
                : 'muted';
              const label = p.isConfigured && p.isEnabled
                ? t('cards.providerEnabled')
                : p.isConfigured
                ? t('cards.providerDisabled')
                : t('cards.providerNotConfigured');
              return (
                <li key={p.platform} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-700 dark:text-slate-300">{meta.displayName}</span>
                  <Badge variant={variant}>{label}</Badge>
                </li>
              );
            })}
          </ul>
        </StatusCard>

        <StatusCard title={t('cards.adAccounts')}>
          <BigNumber primary={data.adAccounts.tracked} secondary={data.adAccounts.total} primaryLabel={t('cards.tracked')} secondaryLabel={t('cards.total')} />
          <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            {data.adAccounts.perPlatform.map((p) => (
              <li key={p.platform} className="flex items-center justify-between">
                <span>{PLATFORM_META[p.platform].displayName}</span>
                <span>{p.tracked}/{p.tracked + p.available}</span>
              </li>
            ))}
          </ul>
          <Link href={'/ad-accounts' as '/'} className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline">
            {t('cards.manageAdAccounts')} →
          </Link>
        </StatusCard>

        <StatusCard title={t('cards.campaigns')}>
          <BigNumber primary={data.campaigns.total} secondary={data.campaigns.activeAndEligible} primaryLabel={t('cards.synced')} secondaryLabel={t('cards.eligible')} />
          <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            {Object.entries(data.campaigns.byPhase).map(([phase, count]) => (
              <li key={phase} className="flex items-center justify-between">
                <span>{phase}</span>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        </StatusCard>

        <StatusCard title={t('cards.adSets')}>
          <BigNumber primary={data.adSets.total} primaryLabel={t('cards.totalAdSets')} />
        </StatusCard>

        <StatusCard title={t('cards.optimizer')}>
          <BigNumber primary={data.optimizer.ruleCount} primaryLabel={t('cards.rules')} />
          <ul className="mt-3 flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            <li className="flex justify-between">
              <span>{t('cards.autoApply')}</span>
              <Badge variant={data.optimizer.autoApplyEnabled ? 'warning' : 'success'}>
                {data.optimizer.autoApplyEnabled ? t('cards.on') : t('cards.off')}
              </Badge>
            </li>
            <li className="flex justify-between">
              <span>{t('cards.cooldownActive')}</span>
              <span>{data.optimizer.cooldownActive}</span>
            </li>
          </ul>
        </StatusCard>

        <StatusCard title={t('cards.snapshots')}>
          <BigNumber primary={data.ingestion.snapshotsLast24h} primaryLabel={t('cards.snapshots24h')} />
          {data.ingestion.lastRunAt && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t('cards.lastIngest', { when: new Date(data.ingestion.lastRunAt).toLocaleString() })}
            </p>
          )}
        </StatusCard>
      </section>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {t('generatedAt', { when: new Date(data.generatedAt).toLocaleString() })}
      </p>
    </PageContainer>
  );
}

function ChecklistRow({ label, item }: { label: string; item: ChecklistItem }) {
  const t = useTranslations('activationLab.checklist.status');
  const color: Record<ChecklistStatus, string> = {
    ok:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    warn:    'bg-amber-100   text-amber-700   dark:bg-amber-900/30   dark:text-amber-400',
    missing: 'bg-red-100     text-red-700     dark:bg-red-900/30     dark:text-red-400',
  };
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-700/60">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${color[item.status]}`} aria-hidden>
        {item.status === 'ok' ? '✓' : item.status === 'warn' ? '!' : '×'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>
      </div>
      <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{t(item.status)}</span>
    </li>
  );
}

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function BigNumber({ primary, primaryLabel, secondary, secondaryLabel }: {
  primary: number;
  primaryLabel: string;
  secondary?: number;
  secondaryLabel?: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <div>
        <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{primary}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{primaryLabel}</p>
      </div>
      {secondary !== undefined && (
        <div className="text-end">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{secondary}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{secondaryLabel}</p>
        </div>
      )}
    </div>
  );
}
