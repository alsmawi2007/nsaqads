'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import type { Confidence, ConfidenceLabel } from '../../api/types';

const LABEL_CLASS: Record<ConfidenceLabel, string> = {
  HIGH: 'text-emerald-700 dark:text-emerald-400',
  MEDIUM: 'text-amber-700 dark:text-amber-400',
  LOW: 'text-red-700 dark:text-red-400',
};

const BAR_CLASS: Record<ConfidenceLabel, string> = {
  HIGH: 'bg-emerald-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-red-500',
};

interface ConfidenceMeterProps {
  confidence: Confidence;
  compact?: boolean;
}

export function ConfidenceMeter({ confidence, compact = false }: ConfidenceMeterProps) {
  const t = useTranslations('campaignArchitect');

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className={cn('h-full rounded-full', BAR_CLASS[confidence.label])}
            style={{ width: `${confidence.score}%` }}
          />
        </div>
        <span className={cn('text-xs font-semibold', LABEL_CLASS[confidence.label])}>
          {confidence.score}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('plan_confidence_label')}
        </span>
        <span className={cn('text-xs font-semibold', LABEL_CLASS[confidence.label])}>
          {t(`plan_confidence_${confidence.label}` as Parameters<typeof t>[0])}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-slate-900 dark:text-slate-100">
          <bdi>{confidence.score}</bdi>
        </span>
        <span className="text-sm text-slate-400">/ 100</span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div
          className={cn('h-full rounded-full transition-all', BAR_CLASS[confidence.label])}
          style={{ width: `${confidence.score}%` }}
        />
      </div>

      {confidence.factors.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t('plan_confidence_factors')}
          </span>
          {confidence.factors.map((f) => (
            <div key={f.key} className="flex items-start gap-3 text-xs">
              <span className="min-w-[110px] font-medium text-slate-600 dark:text-slate-300">
                {t(`plan_factor_${f.key}` as Parameters<typeof t>[0])}
              </span>
              <span className="flex-1 text-slate-500 dark:text-slate-400">{f.note}</span>
              <span className="font-mono text-slate-400 dark:text-slate-500">
                <bdi>{f.score}</bdi>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
