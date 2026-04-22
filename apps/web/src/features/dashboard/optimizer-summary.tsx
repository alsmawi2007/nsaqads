'use client';

import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils/format';
import { Link } from '@/lib/i18n/navigation';
import type { DashboardOptimizerAction, OptimizerTodaySummary } from './mock-data';

// ─── Stat pill ────────────────────────────────────────────────────────────────

interface StatPillProps {
  count: number;
  label: string;
  colorClass: string;
}

function StatPill({ count, label, colorClass }: StatPillProps) {
  return (
    <div className={cn('flex flex-col items-center gap-0.5 rounded-lg px-3 py-2', colorClass)}>
      <span className="text-xl font-bold leading-none">{count}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

// ─── Action type label ────────────────────────────────────────────────────────

const actionTypeLabel: Record<string, string> = {
  INCREASE_BUDGET:         'Budget ↑',
  DECREASE_BUDGET:         'Budget ↓',
  SWITCH_BIDDING_STRATEGY: 'Strategy',
  ADJUST_BID_CEILING:      'Bid ceiling',
  ADJUST_BID_FLOOR:        'Bid floor',
};

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  APPLIED:     'success',
  PENDING:     'warning',
  FAILED:      'danger',
  SKIPPED:     'muted',
  ROLLED_BACK: 'muted',
};

// ─── Mini action row ──────────────────────────────────────────────────────────

function MiniActionRow({ action, locale }: { action: DashboardOptimizerAction; locale: string }) {
  const tO = useTranslations('optimizer');
  const explanation = action.explanation.en;

  // Diff: extract human-readable before→after
  const beforeEntries = Object.entries(action.before);
  const afterEntries  = Object.entries(action.after);
  const firstBefore   = beforeEntries[0];
  const firstAfter    = afterEntries[0];
  const hasDiff       = firstBefore && firstAfter && firstBefore[1] !== firstAfter[1];

  return (
    <div className="flex items-start gap-3 py-2.5">
      {/* Left accent line by status */}
      <div
        className={cn(
          'mt-1 h-2 w-2 shrink-0 rounded-full',
          action.status === 'APPLIED'  && 'bg-emerald-500',
          action.status === 'PENDING'  && 'bg-amber-400',
          action.status === 'FAILED'   && 'bg-red-500',
          action.status === 'SKIPPED'  && 'bg-slate-300 dark:bg-slate-600',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {actionTypeLabel[action.actionType] ?? action.actionType}
          </span>
          <span className="text-xs text-slate-400">·</span>
          <span className="truncate text-xs text-slate-500 dark:text-slate-400">
            {action.campaignName}
          </span>
        </div>
        {/* Before → After diff */}
        {hasDiff && (
          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            {String(firstBefore[1])} → <span className="font-medium text-slate-600 dark:text-slate-300">{String(firstAfter[1])}</span>
          </p>
        )}
        {/* Explanation excerpt */}
        {explanation && action.status !== 'SKIPPED' && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400 dark:text-slate-500">
            {explanation}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant={statusVariant[action.status] ?? 'muted'}>
          {tO(`status_${action.status.toLowerCase()}` as Parameters<typeof tO>[0])}
        </Badge>
        <span className="text-[10px] text-slate-400">
          {formatRelativeTime(action.createdAt, locale)}
        </span>
      </div>
    </div>
  );
}

// ─── Optimizer Summary card ───────────────────────────────────────────────────

interface OptimizerSummaryProps {
  today: OptimizerTodaySummary;
  recentActions: DashboardOptimizerAction[];
}

export function OptimizerSummary({ today, recentActions }: OptimizerSummaryProps) {
  const t  = useTranslations('dashboard');
  const tO = useTranslations('optimizer');
  const locale = useLocale();

  const total = today.applied + today.pending + today.failed + today.skipped;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t('optimizerSummary')}
        </h2>
        <Link
          href="/optimizer"
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('seeAllActions')} →
        </Link>
      </div>

      {/* Stat strip */}
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-700/50">
        <div className="mb-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-slate-900 dark:text-slate-100">{total}</span>
          <span className="text-sm text-slate-400">{t('todayActions')}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <StatPill
            count={today.applied}
            label={tO('status_applied')}
            colorClass="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
          />
          <StatPill
            count={today.pending}
            label={tO('status_pending')}
            colorClass="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
          />
          <StatPill
            count={today.failed}
            label={tO('status_failed')}
            colorClass="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
          />
          <StatPill
            count={today.skipped}
            label={tO('status_skipped')}
            colorClass="bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
          />
        </div>
      </div>

      {/* Recent action log */}
      <div className="flex flex-col divide-y divide-slate-100 px-5 dark:divide-slate-700/50">
        {recentActions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('noActions')}</p>
        ) : (
          recentActions.map((action) => (
            <MiniActionRow key={action.id} action={action} locale={locale} />
          ))
        )}
      </div>
    </div>
  );
}
