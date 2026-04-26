'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Card } from '@/components/ui/card';
import type { StrategicSummary } from '../../api/types';

interface StrategicSummaryCardProps {
  summary: StrategicSummary;
}

export function StrategicSummaryCard({ summary }: StrategicSummaryCardProps) {
  const t = useTranslations('campaignArchitect');
  const locale = useLocale();
  const text = locale === 'ar' && summary.ar ? summary.ar : summary.en;

  return (
    <Card>
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('plan_strategic_summary')}
        </h3>
      </div>
      <div className="px-6 py-4">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{text}</p>
      </div>
    </Card>
  );
}
