/**
 * SimulationCard — displays a single simulated (not-applied) optimizer action.
 *
 * Visually distinct from the real ActionCard:
 *   • Dashed 2px violet border (not solid status-colored)
 *   • "Simulated" badge + "Not Applied" label — unmistakably not real
 *   • No Approve/Reject buttons (simulation actions cannot be actioned here)
 *   • Impact Projection block shows estimated before→after metrics
 *   • Confidence level (HIGH/MEDIUM/LOW) signals how reliable the estimate is
 */

'use client';

import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { formatRelativeTime } from '@/lib/utils/format';
import { ValueDiff } from './value-diff';
import type { SimulateResult, SimulatedImpact } from '@/lib/api/optimizer';

type ImpactDirection = SimulatedImpact['direction'];
type ConfidenceLevel = SimulatedImpact['confidence'];

// ─── Impact metric row ────────────────────────────────────────────────────────

const directionIcon: Record<ImpactDirection, { svg: React.ReactNode; colorClass: string }> = {
  up: {
    svg: (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    ),
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  },
  down: {
    svg: (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
    colorClass: 'text-red-500 dark:text-red-400',
  },
  neutral: {
    svg: (
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14" />
      </svg>
    ),
    colorClass: 'text-slate-400',
  },
};

const confidenceConfig: Record<ConfidenceLevel, { label: string; colorClass: string }> = {
  HIGH:   { label: 'confidenceHigh',   colorClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' },
  MEDIUM: { label: 'confidenceMedium', colorClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'       },
  LOW:    { label: 'confidenceLow',    colorClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'          },
};

function ImpactRow({ impact }: { impact: SimulatedImpact }) {
  const t = useTranslations('optimizer');
  const dir = directionIcon[impact.direction];

  return (
    <div className="flex items-center gap-3">
      {/* Metric name */}
      <span className="w-36 shrink-0 text-xs text-slate-500 dark:text-slate-400">
        {t(`impactMetric_${impact.metric}` as Parameters<typeof t>[0])}
      </span>

      {/* Before → After */}
      <span className="font-mono text-xs text-slate-500 dark:text-slate-500 line-through">
        {impact.before}
      </span>
      <svg className="h-3 w-3 shrink-0 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
      <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
        {impact.after}
      </span>

      {/* Direction indicator */}
      <span className={cn('flex items-center gap-0.5', dir.colorClass)}>
        {dir.svg}
      </span>

      {/* Confidence */}
      <span
        className={cn(
          'ms-auto rounded-full px-2 py-0.5 text-[10px] font-medium',
          confidenceConfig[impact.confidence].colorClass,
        )}
      >
        {t(confidenceConfig[impact.confidence].label as Parameters<typeof t>[0])}
      </span>
    </div>
  );
}

// ─── Impact projection block ──────────────────────────────────────────────────

function ImpactProjection({ impacts }: { impacts: SimulatedImpact[] }) {
  const t = useTranslations('optimizer');

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 dark:border-violet-700/40 dark:bg-violet-900/10">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-violet-200 px-4 py-2.5 dark:border-violet-700/40">
        <svg className="h-3.5 w-3.5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
          {t('projectedImpact')}
        </span>
      </div>

      {/* Metric rows */}
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {impacts.map((impact) => (
          <ImpactRow key={impact.metric} impact={impact} />
        ))}
      </div>

      {/* Disclaimer */}
      <div className="border-t border-violet-100 px-4 py-2 dark:border-violet-700/30">
        <p className="text-[10px] text-violet-400 dark:text-violet-500">
          {t('simulationDisclaimer')}
        </p>
      </div>
    </div>
  );
}

// ─── SimulationCard ───────────────────────────────────────────────────────────

interface SimulationCardProps {
  action: SimulateResult;
}

export function SimulationCard({ action }: SimulationCardProps) {
  const t = useTranslations('optimizer');
  const locale = useLocale();

  const explanation = locale === 'ar' && action.explanation.ar
    ? action.explanation.ar
    : action.explanation.en;

  const actionLabel = t(`action_${action.actionType}` as Parameters<typeof t>[0]);

  return (
    <div
      className={cn(
        // Dashed violet border — the core visual signal for "not real"
        'overflow-hidden rounded-xl border-2 border-dashed border-violet-300 bg-white',
        'dark:border-violet-700/60 dark:bg-slate-800',
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        {/* Simulated badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:border-violet-700/50 dark:bg-violet-900/20 dark:text-violet-300">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 dark:bg-violet-500" />
          {t('simulatedLabel')}
        </span>

        {/* Action type */}
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {actionLabel}
        </span>

        <span className="flex-1" />

        {/* Not applied label */}
        <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-500">
          {t('notApplied')}
        </span>

        {/* Rule name */}
        {action.ruleName && (
          <span className="hidden text-[11px] text-slate-400 dark:text-slate-500 sm:inline">
            {action.ruleName}
          </span>
        )}

        {/* Simulation timestamp */}
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatRelativeTime(action.simulatedAt, locale)}
        </span>
      </div>

      {/* ── Entity line ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-violet-100 bg-violet-50/30 px-5 py-2.5 dark:border-violet-700/30 dark:bg-violet-900/5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {action.adSetName ?? action.campaignName}
        </span>
        {action.adSetName && (
          <span className="text-xs text-slate-400">· {action.campaignName}</span>
        )}
        <PlatformBadge platform={action.platform} />
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {t(`entity_${action.entityType}` as Parameters<typeof t>[0])}
        </span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 px-5 py-4">

        {/* Explanation */}
        {explanation && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 dark:border-slate-700 dark:bg-slate-900/30">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('explainTitle')}
            </p>
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              {explanation}
            </p>
          </div>
        )}

        {/* Before / After diff */}
        <ValueDiff
          actionType={action.actionType}
          before={action.before}
          after={action.after}
        />

        {/* Impact projection — the unique element in simulation mode */}
        {action.projectedImpact.length > 0 ? (
          <ImpactProjection impacts={action.projectedImpact} />
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('projectedImpactUnavailable')}
          </p>
        )}

      </div>
    </div>
  );
}
