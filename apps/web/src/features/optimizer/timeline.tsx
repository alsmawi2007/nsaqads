/**
 * Timeline — groups ActionCards by date with a vertical spine.
 *
 * Structure:
 *   ┌ date group label ──────────────────────────────────────────┐
 *   │  │                                                          │
 *   │  ●── [ActionCard]                                          │
 *   │  │                                                          │
 *   │  ●── [ActionCard]                                          │
 *   │  │                                                          │
 *   └ next date group ───────────────────────────────────────────┘
 *
 * Spine direction: start side (left in LTR, right in RTL).
 *
 * "Load more" button appears at the bottom when not all items are shown.
 */

'use client';

import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { ActionCard } from './action-card';
import type { MockOptimizerAction } from './mock-data';
import type { ActionStatus } from '@/lib/api/optimizer';

// ─── Status dot colour ────────────────────────────────────────────────────────

const dotColor: Record<ActionStatus, string> = {
  APPLIED:     'bg-emerald-500 ring-emerald-100 dark:ring-emerald-900/30',
  PENDING:     'bg-amber-400  ring-amber-100  dark:ring-amber-900/30',
  FAILED:      'bg-red-500    ring-red-100    dark:ring-red-900/30',
  SKIPPED:     'bg-slate-300  ring-slate-100  dark:bg-slate-500 dark:ring-slate-800',
  ROLLED_BACK: 'bg-orange-400 ring-orange-100 dark:ring-orange-900/30',
};

// ─── Date grouping ────────────────────────────────────────────────────────────

function dateGroupLabel(iso: string, locale: string, todayLabel: string, yesterdayLabel: string): string {
  const d     = new Date(iso);
  const today = new Date();
  const yest  = new Date(today); yest.setDate(yest.getDate() - 1);

  const fmt = (d: Date) => d.toDateString();
  if (fmt(d) === fmt(today)) return todayLabel;
  if (fmt(d) === fmt(yest))  return yesterdayLabel;

  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
  }).format(d);
}

function groupByDate(
  actions: MockOptimizerAction[],
  locale: string,
  todayLabel: string,
  yesterdayLabel: string,
): { label: string; items: MockOptimizerAction[] }[] {
  const map = new Map<string, MockOptimizerAction[]>();

  for (const a of actions) {
    const label = dateGroupLabel(a.createdAt, locale, todayLabel, yesterdayLabel);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(a);
  }

  return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
}

// ─── Timeline group ───────────────────────────────────────────────────────────

function TimelineGroup({
  label,
  items,
  onApprove,
  onReject,
}: {
  label: string;
  items: MockOptimizerAction[];
  onApprove?: (id: string) => void;
  onReject?:  (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0">
      {/* Date label */}
      <div className="flex items-center gap-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Actions with spine */}
      <div className="relative flex flex-col gap-4 ps-7">
        {/* Vertical spine */}
        <div
          className="pointer-events-none absolute bottom-4 start-[9px] top-0 w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden
        />

        {items.map((action) => (
          <div key={action.id} className="relative flex items-start gap-4">
            {/* Status dot on the spine */}
            <div
              className={cn(
                'absolute start-[-28px] top-4 h-4 w-4 shrink-0 rounded-full ring-4',
                dotColor[action.status],
              )}
              aria-hidden
            />
            {/* Card */}
            <div className="w-full">
              <ActionCard
                action={action}
                onApprove={onApprove}
                onReject={onReject}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyTimeline({ filtered }: { filtered: boolean }) {
  const t = useTranslations('optimizer');
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 py-16 dark:border-slate-600">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <svg className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {filtered ? t('noActionsFiltered') : t('noActions')}
      </p>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 8;

interface TimelineProps {
  actions: MockOptimizerAction[];
  totalUnfiltered: number;
  onApprove?: (id: string) => void;
  onReject?:  (id: string) => void;
  visibleCount: number;
  onLoadMore: () => void;
}

export function Timeline({
  actions,
  totalUnfiltered,
  onApprove,
  onReject,
  visibleCount,
  onLoadMore,
}: TimelineProps) {
  const t      = useTranslations('optimizer');
  const locale = useLocale();

  const visible  = actions.slice(0, visibleCount);
  const hasMore  = visibleCount < actions.length;
  const groups   = groupByDate(visible, locale, t('today'), t('yesterday'));
  const filtered = actions.length < totalUnfiltered;

  if (actions.length === 0) return <EmptyTimeline filtered={filtered} />;

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => (
        <TimelineGroup
          key={g.label}
          label={g.label}
          items={g.items}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            {t('loadMore')}
            <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400">
              {t('loadMoreRemaining', { count: actions.length - visibleCount })}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export { PAGE_SIZE };
