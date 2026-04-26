'use client';

import { useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/utils/format';
import type { PlanResponse } from '../../api/types';

// Rule-based directional projection. The numbers below are deliberately
// conservative — we want to inform expectations, not promise outcomes.
//
// Per platform, daily budget × CTR/CPM benchmark gives impressions and clicks.
// Conversion rate ranges from 1% (AWARENESS) to 6% (SALES with pixel).
// Reach is approximated as 0.4 × impressions (average frequency ~2.5).

const CPM_USD: Record<string, number> = {
  META: 8,
  GOOGLE_ADS: 12,
  TIKTOK: 6,
  SNAPCHAT: 5,
};

const CTR_BY_GOAL: Record<string, number> = {
  AWARENESS: 0.006,
  TRAFFIC: 0.012,
  ENGAGEMENT: 0.018,
  LEADS: 0.011,
  SALES: 0.014,
  APP_INSTALLS: 0.015,
};

const CONV_RATE_BY_GOAL: Record<string, number> = {
  AWARENESS: 0,
  TRAFFIC: 0,
  ENGAGEMENT: 0,
  LEADS: 0.04,
  SALES: 0.025,
  APP_INSTALLS: 0.06,
};

interface EstimatedImpactProps {
  plan: PlanResponse;
}

export function EstimatedImpact({ plan }: EstimatedImpactProps) {
  const t = useTranslations('campaignArchitect');
  const locale = useLocale();

  const { impressions, clicks, conversions, reach } = useMemo(() => {
    let totImp = 0;
    let totClicks = 0;
    let totConv = 0;

    for (const item of plan.items) {
      const cpm = CPM_USD[item.platform] ?? 8;
      const ctr = CTR_BY_GOAL[plan.goal] ?? 0.01;
      const convRate = CONV_RATE_BY_GOAL[plan.goal] ?? 0;
      const pixelBoost =
        plan.goal === 'SALES' || plan.goal === 'LEADS'
          ? (plan.creativeBrief as { pixelInstalled?: boolean }).pixelInstalled
            ? 1.4
            : 0.7
          : 1;

      const dailyImp = (item.dailyBudget / cpm) * 1000;
      const dailyClicks = dailyImp * ctr;
      const dailyConv = dailyClicks * convRate * pixelBoost;

      totImp += dailyImp;
      totClicks += dailyClicks;
      totConv += dailyConv;
    }

    return {
      impressions: Math.round(totImp),
      clicks: Math.round(totClicks),
      conversions: Math.round(totConv),
      reach: Math.round(totImp * 0.4),
    };
  }, [plan]);

  const showConversions = conversions > 0;

  return (
    <Card>
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t('plan_estimated_impact')}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {t('plan_estimated_impact_desc')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-200 dark:bg-slate-700 sm:grid-cols-4">
        <Cell
          label={t('plan_impact_reach')}
          value={formatNumber(reach, locale)}
          suffix={t('plan_impact_per_day')}
        />
        <Cell
          label={t('plan_impact_impressions')}
          value={formatNumber(impressions, locale)}
          suffix={t('plan_impact_per_day')}
        />
        <Cell
          label={t('plan_impact_clicks')}
          value={formatNumber(clicks, locale)}
          suffix={t('plan_impact_per_day')}
        />
        <Cell
          label={t('plan_impact_conversions')}
          value={showConversions ? formatNumber(conversions, locale) : '—'}
          suffix={showConversions ? t('plan_impact_per_day') : ''}
        />
      </div>
    </Card>
  );
}

function Cell({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <div className="flex flex-col gap-1 bg-white px-4 py-4 dark:bg-slate-800">
      <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
        <bdi>{value}</bdi>
        {suffix && <span className="ms-1 text-xs font-normal text-slate-400">{suffix}</span>}
      </span>
    </div>
  );
}
