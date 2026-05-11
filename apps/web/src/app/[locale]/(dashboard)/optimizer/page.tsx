'use client';

/**
 * Optimizer Page
 *
 * Two views on one page, switched by a tab toggle:
 *
 *   ACTION LOG  — canonical audit trail of every real optimizer decision.
 *                 Data: useQuery → optimizerApi.listActions()
 *
 *   SIMULATION  — read-only "what would happen" preview.
 *                 Data: useMutation → optimizerApi.simulate()
 *                 Returns SimulateResult[] — enriched proposed actions, never persisted.
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth.store';
import { optimizerApi } from '@/lib/api/optimizer';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { FilterBar, EMPTY_FILTER, type FilterState } from '@/features/optimizer/filter-bar';
import { Timeline, PAGE_SIZE } from '@/features/optimizer/timeline';
import { SimulationCard } from '@/features/optimizer/simulation-card';
import { cn } from '@/lib/utils/cn';
import type { ActionStatus, OptimizerAction, SimulateResult } from '@/lib/api/optimizer';

// ─── View mode ────────────────────────────────────────────────────────────────

type ViewMode = 'log' | 'simulation';

// ─── Tab toggle ───────────────────────────────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const t = useTranslations('optimizer');
  return (
    <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {(['log', 'simulation'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            mode === m
              ? m === 'simulation'
                ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
                : 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {m === 'simulation' && (
            <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          )}
          {t(m === 'log' ? 'viewLog' : 'viewSimulation')}
        </button>
      ))}
    </div>
  );
}

// ─── Simulation banner ────────────────────────────────────────────────────────

function SimulationBanner({ lastRunAt, locale }: { lastRunAt: string; locale: string }) {
  const t = useTranslations('optimizer');

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 dark:border-violet-700/50 dark:bg-violet-900/15">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
        <svg className="h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-violet-800 dark:text-violet-200">
          {t('simulationBannerTitle')}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-violet-600 dark:text-violet-400">
          {t('simulationBannerDesc')}
        </p>
        <p className="mt-1.5 text-[11px] text-violet-400 dark:text-violet-500">
          {t('simulationLastRun')} · {new Date(lastRunAt).toLocaleTimeString(
            locale === 'ar' ? 'ar-SA' : 'en-US',
            { hour: '2-digit', minute: '2-digit' },
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Simulation view ──────────────────────────────────────────────────────────

function SimulationView({
  actions,
  running,
  onRun,
}: {
  actions: SimulateResult[] | null;
  running: boolean;
  onRun: () => void;
}) {
  const t = useTranslations('optimizer');

  if (!actions) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-violet-200 py-16 dark:border-violet-700/40">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-900/20">
          <svg className="h-6 w-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('simulationEmpty')}
        </p>
        <Button size="sm" variant="secondary" loading={running} onClick={onRun}>
          {running ? t('runningSimulation') : t('runSimulation')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {actions.map((action) => (
        <SimulationCard key={action.id} action={action} />
      ))}
    </div>
  );
}

// ─── Stats strip (log mode) ───────────────────────────────────────────────────

function StatStrip({ actions }: { actions: OptimizerAction[] }) {
  const t = useTranslations('optimizer');

  const counts = useMemo(() => {
    const c: Partial<Record<ActionStatus, number>> = {};
    for (const a of actions) { c[a.status] = (c[a.status] ?? 0) + 1; }
    return c;
  }, [actions]);

  const pills: { status: ActionStatus; colorClass: string }[] = [
    { status: 'PENDING',     colorClass: 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/50' },
    { status: 'APPLIED',     colorClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/50' },
    { status: 'FAILED',      colorClass: 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700/50' },
    { status: 'SKIPPED',     colorClass: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600' },
    { status: 'ROLLED_BACK', colorClass: 'bg-orange-50 text-orange-800 border border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700/50' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {pills.map(({ status, colorClass }) => {
        const count = counts[status] ?? 0;
        if (count === 0) return null;
        return (
          <span key={status} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${colorClass}`}>
            <span className="text-base font-bold leading-none">{count}</span>
            {t(`status_${status.toLowerCase()}` as Parameters<typeof t>[0])}
          </span>
        );
      })}
    </div>
  );
}

// ─── Simulation stat strip ────────────────────────────────────────────────────

function SimulationStatStrip({ count }: { count: number }) {
  const t = useTranslations('optimizer');

  if (count === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 dark:border-violet-700/50 dark:bg-violet-900/20 dark:text-violet-300">
        <span className="text-base font-bold leading-none">{count}</span>
        {t('simulatedLabel')}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        {t('notApplied')}
      </span>
    </div>
  );
}

// ─── Filter logic ─────────────────────────────────────────────────────────────

function applyFilters(actions: OptimizerAction[], f: FilterState): OptimizerAction[] {
  return actions.filter((a) => {
    if (f.statuses.length > 0 && !f.statuses.includes(a.status)) return false;
    if (f.campaignId !== null && a.campaignId !== f.campaignId) return false;
    if (f.dateFrom !== null) {
      if (a.createdAt.slice(0, 10) < f.dateFrom) return false;
    }
    if (f.dateTo !== null) {
      if (a.createdAt.slice(0, 10) > f.dateTo) return false;
    }
    return true;
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OptimizerPage() {
  const t      = useTranslations('optimizer');
  const locale = useLocale();
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [viewMode, setViewMode]     = useState<ViewMode>('log');
  const [filters, setFilters]       = useState<FilterState>(EMPTY_FILTER);
  const [visibleCount, setVisible]  = useState(PAGE_SIZE);
  const [simResults, setSimResults] = useState<SimulateResult[] | null>(null);
  const [simLastRun, setSimLastRun] = useState<string | null>(null);

  // ── Action log query ────────────────────────────────────────────────────
  const { data: rawActions = [] } = useQuery({
    queryKey: ['optimizer-actions', orgId],
    queryFn:  () => optimizerApi.listActions(orgId, { limit: 100 }),
    enabled:  !!orgId,
    staleTime: 30_000,
  });

  // ── Run cycle mutation ──────────────────────────────────────────────────
  const runCycleMutation = useMutation({
    mutationFn: () => optimizerApi.runCycle(orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['optimizer-actions', orgId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', orgId] });
    },
  });

  // ── Simulate mutation ───────────────────────────────────────────────────
  const simulateMutation = useMutation({
    mutationFn: () => optimizerApi.simulate(orgId),
    onSuccess: (data) => {
      setSimResults(data);
      setSimLastRun(new Date().toISOString());
    },
  });

  // ── Approve / reject mutations ──────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: (actionId: string) => optimizerApi.approveAction(orgId, actionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['optimizer-actions', orgId] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (actionId: string) => optimizerApi.rejectAction(orgId, actionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['optimizer-actions', orgId] }),
  });

  // Sort descending by createdAt
  const allSorted = useMemo(
    () => [...rawActions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rawActions],
  );

  const filtered = useMemo(() => applyFilters(allSorted, filters), [allSorted, filters]);

  // Unique campaign list for filter dropdown
  const uniqueCampaigns = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of allSorted) seen.set(a.campaignId, a.campaignName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [allSorted]);

  function handleFilterChange(f: FilterState) {
    setFilters(f);
    setVisible(PAGE_SIZE);
  }

  const handleLoadMore = useCallback(() => {
    setVisible((v) => v + PAGE_SIZE);
  }, []);

  const handleApprove = useCallback((id: string) => {
    approveMutation.mutate(id);
  }, [approveMutation]);

  const handleReject = useCallback((id: string) => {
    rejectMutation.mutate(id);
  }, [rejectMutation]);

  const isSimulation = viewMode === 'simulation';

  return (
    <PageContainer className="gap-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t('title')}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {t('subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ViewToggle mode={viewMode} onChange={setViewMode} />

          {isSimulation ? (
            <Button
              size="sm"
              variant="secondary"
              loading={simulateMutation.isPending}
              onClick={() => simulateMutation.mutate()}
            >
              {simulateMutation.isPending ? t('runningSimulation') : t('runSimulation')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={runCycleMutation.isPending}
              onClick={() => runCycleMutation.mutate()}
            >
              {runCycleMutation.isPending ? t('runningCycle') : t('runCycle')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Simulation banner ─────────────────────────────────────────────── */}
      {isSimulation && simLastRun && (
        <SimulationBanner lastRunAt={simLastRun} locale={locale} />
      )}

      {/* ── Stats strip ─────────────────────────────────────────────────── */}
      {isSimulation
        ? <SimulationStatStrip count={simResults?.length ?? 0} />
        : <StatStrip actions={filtered} />
      }

      {/* ── Filter bar (log mode only) ───────────────────────────────────── */}
      {!isSimulation && (
        <FilterBar
          filters={filters}
          campaigns={uniqueCampaigns}
          totalCount={allSorted.length}
          filteredCount={filtered.length}
          onChange={handleFilterChange}
        />
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      {isSimulation ? (
        <SimulationView
          actions={simResults}
          running={simulateMutation.isPending}
          onRun={() => simulateMutation.mutate()}
        />
      ) : (
        <Timeline
          actions={filtered}
          totalUnfiltered={allSorted.length}
          visibleCount={visibleCount}
          onLoadMore={handleLoadMore}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}

    </PageContainer>
  );
}
