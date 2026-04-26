'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { formatCurrency } from '@/lib/utils/format';
import type { PlanItem } from '../../api/types';

interface PlanItemsListProps {
  items: PlanItem[];
  currency: string;
}

export function PlanItemsList({ items, currency }: PlanItemsListProps) {
  const t = useTranslations('campaignArchitect');
  const locale = useLocale();

  return (
    <Card>
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('plan_items')}
        </h3>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {items.map((item) => (
          <li key={item.id} className="px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <PlatformBadge platform={item.platform} />
                {item.isCbo && <Badge variant="info">{t('plan_item_cbo')}</Badge>}
              </div>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                <bdi>{formatCurrency(item.dailyBudget, locale, currency)}</bdi>
                <span className="ms-1 text-xs font-normal text-slate-400">
                  {t('plan_impact_per_day')}
                </span>
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                  {t('plan_item_objective')}
                </dt>
                <dd className="mt-0.5 text-slate-700 dark:text-slate-200">{item.objective}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                  {t('plan_item_strategy')}
                </dt>
                <dd className="mt-0.5 text-slate-700 dark:text-slate-200">
                  {item.biddingStrategy}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                  {t('plan_item_bid_target')}
                </dt>
                <dd className="mt-0.5 text-slate-700 dark:text-slate-200">
                  <bdi>
                    {item.bidTarget != null
                      ? formatCurrency(item.bidTarget, locale, currency)
                      : '—'}
                  </bdi>
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}
