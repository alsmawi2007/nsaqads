'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { RiskFinding, RiskSeverity } from '../../api/types';

const SEV_CLASS: Record<RiskSeverity, string> = {
  BLOCKER: 'border-red-300 bg-red-50/60 dark:border-red-700/50 dark:bg-red-900/10',
  WARNING: 'border-amber-300 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-900/10',
};

const SEV_VARIANT: Record<RiskSeverity, 'danger' | 'warning'> = {
  BLOCKER: 'danger',
  WARNING: 'warning',
};

const SEV_RANK: Record<RiskSeverity, number> = {
  BLOCKER: 0,
  WARNING: 1,
};

interface RisksListProps {
  risks: RiskFinding[];
}

export function RisksList({ risks }: RisksListProps) {
  const t = useTranslations('campaignArchitect');

  // Sort BLOCKER first, then WARNING.
  const sorted = [...risks].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  return (
    <Card>
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('plan_risks')}
        </h3>
      </div>
      <div className="px-6 py-4">
        {sorted.length === 0 ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {t('plan_risks_none')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((r, i) => (
              <li
                key={`${r.code}-${r.platform ?? 'plan'}-${i}`}
                className={cn('flex items-start gap-3 rounded-lg border p-3', SEV_CLASS[r.severity])}
              >
                <Badge variant={SEV_VARIANT[r.severity]}>
                  {t(`plan_risk_${r.severity}` as Parameters<typeof t>[0])}
                </Badge>
                <div className="flex flex-1 flex-col gap-0.5">
                  <p className="text-sm text-slate-800 dark:text-slate-100">{r.message}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {r.code}
                    {r.platform ? ` · ${r.platform}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
