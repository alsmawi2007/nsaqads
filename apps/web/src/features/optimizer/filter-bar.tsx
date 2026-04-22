/**
 * FilterBar — filter controls for the optimizer actions log.
 *
 * Three filter axes:
 *   1. Status chips     — visible toggle chips (not a dropdown) for the 5 statuses
 *   2. Campaign select  — searchable select for campaign name
 *   3. Date range       — preset pills (Today / Yesterday / 7d / 30d) + custom from/to
 *
 * Design: filter bar sits above the timeline. Active filters show a "Clear" link.
 * Filters are local state; swap the `applyFilters` logic for query param updates
 * when the API is connected.
 */

'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import type { ActionStatus } from '@/lib/api/optimizer';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DatePreset = 'today' | 'yesterday' | '7d' | '30d' | null;

export interface FilterState {
  statuses:   ActionStatus[];   // empty = all
  campaignId: string | null;    // null = all
  preset:     DatePreset;
  dateFrom:   string | null;    // ISO date YYYY-MM-DD
  dateTo:     string | null;
}

export const EMPTY_FILTER: FilterState = {
  statuses: [], campaignId: null, preset: null, dateFrom: null, dateTo: null,
};

// ─── Status config ────────────────────────────────────────────────────────────

const ALL_STATUSES: ActionStatus[] = ['APPLIED', 'PENDING', 'FAILED', 'SKIPPED', 'ROLLED_BACK'];

const statusChipConfig: Record<ActionStatus, { active: string }> = {
  APPLIED:     { active: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' },
  PENDING:     { active: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'           },
  FAILED:      { active: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700'                       },
  SKIPPED:     { active: 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-500'              },
  ROLLED_BACK: { active: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700'     },
};

const INACTIVE_CHIP = 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600 dark:hover:bg-slate-700';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFilterActive(f: FilterState): boolean {
  return f.statuses.length > 0 || f.campaignId !== null || f.preset !== null;
}

// ─── Section label ────────────────────────────────────────────────────────────

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
      {children}
    </span>
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: FilterState;
  campaigns: { id: string; name: string }[];
  totalCount: number;
  filteredCount: number;
  onChange: (f: FilterState) => void;
}

export function FilterBar({ filters, campaigns, totalCount, filteredCount, onChange }: FilterBarProps) {
  const t = useTranslations('optimizer');

  function toggleStatus(s: ActionStatus) {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s];
    onChange({ ...filters, statuses: next });
  }

  function setPreset(p: DatePreset) {
    const now = new Date();
    let dateFrom: string | null = null;
    let dateTo: string | null   = null;

    if (p === 'today') {
      dateFrom = dateTo = now.toISOString().slice(0, 10);
    } else if (p === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      dateFrom = dateTo = y.toISOString().slice(0, 10);
    } else if (p === '7d') {
      const from = new Date(now); from.setDate(from.getDate() - 6);
      dateFrom = from.toISOString().slice(0, 10);
      dateTo   = now.toISOString().slice(0, 10);
    } else if (p === '30d') {
      const from = new Date(now); from.setDate(from.getDate() - 29);
      dateFrom = from.toISOString().slice(0, 10);
      dateTo   = now.toISOString().slice(0, 10);
    }

    onChange({ ...filters, preset: p === filters.preset ? null : p, dateFrom, dateTo });
  }

  const hasActiveFilters = isFilterActive(filters);
  const showingAll = filteredCount === totalCount;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">

        {/* ── Status chips ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <FilterLabel>{t('filterStatus')}</FilterLabel>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => {
              const active = filters.statuses.includes(s);
              const cfg    = statusChipConfig[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                    active ? cfg.active : INACTIVE_CHIP,
                  )}
                >
                  {t(`status_${s.toLowerCase()}` as Parameters<typeof t>[0])}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Campaign select ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <FilterLabel>{t('filterCampaign')}</FilterLabel>
          <select
            value={filters.campaignId ?? ''}
            onChange={(e) => onChange({ ...filters, campaignId: e.target.value || null })}
            className="h-8 rounded-lg border border-slate-200 bg-white pe-8 ps-3 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="">{t('allCampaigns')}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* ── Date range presets ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <FilterLabel>{t('filterDate')}</FilterLabel>
          <div className="flex gap-1.5">
            {(['today', 'yesterday', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={cn(
                  'rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                  filters.preset === p
                    ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                    : INACTIVE_CHIP,
                )}
              >
                {t(`preset_${p}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        {/* ── Clear + count ─────────────────────────────────────────────── */}
        <div className="ms-auto flex items-end gap-3">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/20 transition-colors"
            >
              {t('clearFilters')}
            </button>
          )}
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {showingAll
              ? t('showingCount', { count: totalCount })
              : t('countFiltered', { filtered: filteredCount, total: totalCount })}
          </span>
        </div>
      </div>
    </div>
  );
}
