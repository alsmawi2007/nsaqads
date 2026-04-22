'use client';

import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatNumber, formatPercent, formatRoas } from '@/lib/utils/format';
import type { DashboardKPIs } from './mock-data';

// ─── Trend indicator ──────────────────────────────────────────────────────────

interface TrendProps {
  value: number;
  /** When true, a negative value is shown green (e.g. CPA going down is good) */
  invertGood?: boolean;
  label: string;
}

function Trend({ value, invertGood = false, label }: TrendProps) {
  const isPositive = value >= 0;
  // "good" means green in normal cases; for CPA lower is better so invert
  const isGood = invertGood ? !isPositive : isPositive;
  const abs = Math.abs(value).toFixed(1);

  return (
    <div className="flex items-center gap-1">
      <span
        className={cn(
          'flex items-center gap-0.5 text-xs font-medium',
          isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
        )}
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          {isPositive ? (
            <path d="M6 2.5L10 7.5H2L6 2.5Z" fill="currentColor" />
          ) : (
            <path d="M6 9.5L2 4.5H10L6 9.5Z" fill="currentColor" />
          )}
        </svg>
        {abs}%
      </span>
      <span className="text-xs text-slate-400 dark:text-slate-500">{label}</span>
    </div>
  );
}

// ─── Single KPI card ──────────────────────────────────────────────────────────

interface KPIMetricCardProps {
  title: string;
  value: string;
  trend: number;
  invertGood?: boolean;
  trendLabel: string;
  icon: React.ReactNode;
  accentClass: string;  // tailwind bg class for icon container
}

function KPIMetricCard({ title, value, trend, invertGood, trendLabel, icon, accentClass }: KPIMetricCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </p>
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', accentClass)}>
          {icon}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-semibold leading-none text-slate-900 dark:text-slate-100">
          {value}
        </p>
        <Trend value={trend} invertGood={invertGood} label={trendLabel} />
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const SpendIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
  </svg>
);
const ConvIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const RoasIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
  </svg>
);
const CpaIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);
const CtrIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
      d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
  </svg>
);

// ─── KPI Section ─────────────────────────────────────────────────────────────

interface KPISectionProps {
  data: DashboardKPIs;
}

export function KPISection({ data }: KPISectionProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const cards: KPIMetricCardProps[] = [
    {
      title:       t('totalSpend'),
      value:       formatCurrency(data.totalSpend, locale, 'SAR'),
      trend:       data.trends.spend,
      trendLabel:  t('vsYesterday'),
      icon:        <SpendIcon />,
      accentClass: 'bg-brand-50 text-brand-600 dark:bg-brand-900/20 dark:text-brand-400',
    },
    {
      title:       t('totalConversions'),
      value:       formatNumber(data.totalConversions, locale),
      trend:       data.trends.conversions,
      trendLabel:  t('vsYesterday'),
      icon:        <ConvIcon />,
      accentClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
    },
    {
      title:       t('avgRoas'),
      value:       formatRoas(data.avgRoas),
      trend:       data.trends.roas,
      trendLabel:  t('vsYesterday'),
      icon:        <RoasIcon />,
      accentClass: 'bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400',
    },
    {
      title:       t('avgCpa'),
      value:       formatCurrency(data.avgCpa, locale, 'SAR'),
      trend:       data.trends.cpa,
      invertGood:  true,  // lower CPA is better
      trendLabel:  t('vsYesterday'),
      icon:        <CpaIcon />,
      accentClass: 'bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400',
    },
    {
      title:       t('avgCtr'),
      value:       formatPercent(data.avgCtr, locale),
      trend:       data.trends.ctr,
      trendLabel:  t('vsYesterday'),
      icon:        <CtrIcon />,
      accentClass: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <KPIMetricCard key={card.title} {...card} />
      ))}
    </div>
  );
}
