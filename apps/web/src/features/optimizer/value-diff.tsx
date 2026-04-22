/**
 * ValueDiff — smart before/after renderer.
 *
 * Understands each ActionType and formats the raw JSON payload into readable
 * human labels instead of showing raw object keys.
 *
 * Design: two boxes side by side, arrow between, optional delta pill.
 * All user-visible strings go through useTranslations — fully bilingual.
 */

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { formatCurrency } from '@/lib/utils/format';
import type { ActionType } from '@/lib/api/optimizer';

// ─── Strategy label lookup ────────────────────────────────────────────────────
//
// Keys are the raw API enum values; values are translation key suffixes.
// Resolved at render time via t('strategy_*') so Arabic is fully supported.

const STRATEGY_KEY_MAP: Record<string, string> = {
  LOWEST_COST:  'strategy_LOWEST_COST',
  COST_CAP:     'strategy_COST_CAP',
  BID_CAP:      'strategy_BID_CAP',
  TARGET_CPA:   'strategy_TARGET_CPA',
  TARGET_ROAS:  'strategy_TARGET_ROAS',
};

// ─── Delta pill ───────────────────────────────────────────────────────────────

function DeltaPill({ before, after }: { before: number; after: number }) {
  if (before === 0) return null;
  const pct        = ((after - before) / before) * 100;
  const sign       = pct >= 0 ? '+' : '';
  const isIncrease = pct >= 0;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        isIncrease
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
          : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
      )}
    >
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

// ─── Value box ────────────────────────────────────────────────────────────────

interface ValueBoxProps {
  label: string;
  primary: string;
  secondary?: string;
  highlighted?: boolean;
}

function ValueBox({ label, primary, secondary, highlighted }: ValueBoxProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border px-4 py-3 min-w-[120px]',
        highlighted
          ? 'border-brand-200 bg-brand-50 dark:border-brand-700/50 dark:bg-brand-900/10'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40',
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-semibold',
          highlighted
            ? 'text-brand-700 dark:text-brand-300'
            : 'text-slate-600 dark:text-slate-400',
        )}
      >
        {primary}
      </span>
      {secondary && (
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{secondary}</span>
      )}
    </div>
  );
}

// ─── Arrow ────────────────────────────────────────────────────────────────────

function Arrow() {
  return (
    <div className="flex shrink-0 items-center text-slate-300 dark:text-slate-600">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ValueDiffProps {
  actionType: ActionType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export function ValueDiff({ actionType, before, after }: ValueDiffProps) {
  const locale = useLocale();
  const t      = useTranslations('optimizer');

  // Helper: look up a strategy key, fall back to the raw value if unknown
  function strategyLabel(s: unknown): string {
    if (typeof s !== 'string') return '—';
    const tKey = STRATEGY_KEY_MAP[s];
    return tKey ? t(tKey as Parameters<typeof t>[0]) : s;
  }

  // ── Budget actions ──────────────────────────────────────────────────────
  if (actionType === 'INCREASE_BUDGET' || actionType === 'DECREASE_BUDGET') {
    const beforeBudget = Number(before.daily_budget_sar ?? before.daily_budget ?? 0);
    const afterBudget  = Number(after.daily_budget_sar  ?? after.daily_budget  ?? 0);

    return (
      <div className="flex flex-wrap items-center gap-3">
        <ValueBox
          label={t('before')}
          primary={formatCurrency(beforeBudget, locale, 'SAR')}
          secondary={t('labelDailyBudget')}
        />
        <Arrow />
        <ValueBox
          label={t('after')}
          primary={formatCurrency(afterBudget, locale, 'SAR')}
          secondary={t('labelDailyBudget')}
          highlighted
        />
        <DeltaPill before={beforeBudget} after={afterBudget} />
      </div>
    );
  }

  // ── Bidding strategy ─────────────────────────────────────────────────────
  if (actionType === 'SWITCH_BIDDING_STRATEGY') {
    const beforeStrategy = strategyLabel(before.bidding_strategy);
    const afterStrategy  = strategyLabel(after.bidding_strategy);

    const afterCap   = after.cost_cap_sar    != null ? formatCurrency(Number(after.cost_cap_sar),    locale, 'SAR') : null;
    const afterBid   = after.bid_cap_sar     != null ? formatCurrency(Number(after.bid_cap_sar),     locale, 'SAR') : null;
    const afterTcpa  = after.target_cpa_sar  != null ? formatCurrency(Number(after.target_cpa_sar),  locale, 'SAR') : null;
    const beforeCap  = before.cost_cap_sar   != null ? formatCurrency(Number(before.cost_cap_sar),   locale, 'SAR') : null;
    const beforeTcpa = before.target_cpa_sar != null ? formatCurrency(Number(before.target_cpa_sar), locale, 'SAR') : null;

    return (
      <div className="flex flex-wrap items-center gap-3">
        <ValueBox
          label={t('before')}
          primary={beforeStrategy}
          secondary={beforeCap ?? beforeTcpa ?? undefined}
        />
        <Arrow />
        <ValueBox
          label={t('after')}
          primary={afterStrategy}
          secondary={afterCap ?? afterBid ?? afterTcpa ?? undefined}
          highlighted
        />
      </div>
    );
  }

  // ── Bid ceiling ──────────────────────────────────────────────────────────
  if (actionType === 'ADJUST_BID_CEILING') {
    const beforeCeil = before.bid_ceiling_sar;
    const afterCeil  = after.bid_ceiling_sar;

    return (
      <div className="flex flex-wrap items-center gap-3">
        <ValueBox
          label={t('before')}
          primary={beforeCeil != null ? formatCurrency(Number(beforeCeil), locale, 'SAR') : t('labelNoCeiling')}
          secondary={t('labelBidCeiling')}
        />
        <Arrow />
        <ValueBox
          label={t('after')}
          primary={afterCeil != null ? formatCurrency(Number(afterCeil), locale, 'SAR') : t('labelNoCeiling')}
          secondary={t('labelBidCeiling')}
          highlighted
        />
        {beforeCeil != null && afterCeil != null && (
          <DeltaPill before={Number(beforeCeil)} after={Number(afterCeil)} />
        )}
      </div>
    );
  }

  // ── Bid floor ────────────────────────────────────────────────────────────
  if (actionType === 'ADJUST_BID_FLOOR') {
    const beforeFloor = before.bid_floor_sar;
    const afterFloor  = after.bid_floor_sar;

    return (
      <div className="flex flex-wrap items-center gap-3">
        <ValueBox
          label={t('before')}
          primary={beforeFloor != null ? formatCurrency(Number(beforeFloor), locale, 'SAR') : t('labelNoFloor')}
          secondary={t('labelBidFloor')}
        />
        <Arrow />
        <ValueBox
          label={t('after')}
          primary={afterFloor != null ? formatCurrency(Number(afterFloor), locale, 'SAR') : t('labelNoFloor')}
          secondary={t('labelBidFloor')}
          highlighted
        />
        {beforeFloor != null && afterFloor != null && (
          <DeltaPill before={Number(beforeFloor)} after={Number(afterFloor)} />
        )}
      </div>
    );
  }

  // ── Fallback: raw key-value display ──────────────────────────────────────
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ValueBox label={t('before')} primary={JSON.stringify(before)} />
      <Arrow />
      <ValueBox label={t('after')} primary={JSON.stringify(after)} highlighted />
    </div>
  );
}
