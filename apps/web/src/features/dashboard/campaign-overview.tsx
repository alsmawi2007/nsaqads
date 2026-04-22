'use client';

import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { formatCurrency, formatNumber, formatPercent, formatRoas } from '@/lib/utils/format';
import { Link } from '@/lib/i18n/navigation';
import type { DashboardCampaign } from './mock-data';

// ─── Spend pacing bar ─────────────────────────────────────────────────────────

function PacingBar({ pacing }: { pacing: number }) {
  const pct = Math.min(pacing * 100, 100);
  const color =
    pct >= 90 ? 'bg-emerald-500'
    : pct >= 60 ? 'bg-amber-400'
    : 'bg-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Metric pill ──────────────────────────────────────────────────────────────

interface MetricPillProps {
  label: string;
  value: string;
  /** true = value being high is good; false = value being high is bad */
  higherIsBetter?: boolean;
  threshold?: number;  // raw number to compare against
  rawValue?: number;
}

function MetricPill({ label, value }: MetricPillProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}

// ─── Status badge helpers ─────────────────────────────────────────────────────

const statusVariant: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  ACTIVE:   'success',
  PAUSED:   'warning',
  ARCHIVED: 'muted',
  DELETED:  'danger',
};

const phaseVariant: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'muted'> = {
  LEARNING:  'info',
  STABLE:    'success',
  SCALING:   'warning',
  DEGRADED:  'danger',
};

const modeLabel: Record<string, string> = {
  AUTO_APPLY:   '⚡ Auto',
  SUGGEST_ONLY: '🔔 Suggest',
  OFF:          '— Off',
};

// ─── Campaign row ─────────────────────────────────────────────────────────────

function CampaignRow({ campaign, locale, t, tC }: {
  campaign: DashboardCampaign;
  locale: string;
  t: ReturnType<typeof useTranslations<'dashboard'>>;
  tC: ReturnType<typeof useTranslations<'campaigns'>>;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-slate-50/60 dark:border-slate-700/50 dark:hover:bg-slate-700/20 transition-colors">
      {/* Row left: name + badges + metrics */}
      <div className="flex flex-col gap-2 min-w-0">
        {/* Name + platform + status + phase */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="truncate text-sm font-medium text-slate-800 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400 transition-colors"
          >
            {campaign.name}
          </Link>
          <PlatformBadge platform={campaign.platform} />
          <Badge variant={statusVariant[campaign.status] ?? 'muted'}>
            {tC(`status_${campaign.status.toLowerCase()}` as Parameters<typeof tC>[0])}
          </Badge>
          <Badge variant={phaseVariant[campaign.campaignPhase] ?? 'muted'}>
            {tC(`phase_${campaign.campaignPhase.toLowerCase()}` as Parameters<typeof tC>[0])}
          </Badge>
        </div>

        {/* Inline metric pills */}
        <div className="flex flex-wrap items-center gap-4">
          <MetricPill
            label={tC('roas')}
            value={formatRoas(campaign.metrics.roas)}
            higherIsBetter
            rawValue={campaign.metrics.roas}
            threshold={3}
          />
          <MetricPill
            label={tC('cpa')}
            value={formatCurrency(campaign.metrics.cpa, locale, 'SAR')}
            higherIsBetter={false}
            rawValue={campaign.metrics.cpa}
            threshold={20}
          />
          <MetricPill
            label={tC('spend')}
            value={formatCurrency(campaign.metrics.spend, locale, 'SAR')}
          />
          <MetricPill
            label={tC('ctr')}
            value={formatPercent(campaign.metrics.ctr, locale)}
          />
          <MetricPill
            label={tC('conversions')}
            value={formatNumber(campaign.metrics.conversions, locale)}
          />
        </div>
      </div>

      {/* Row right: budget + pacing + mode */}
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {formatCurrency(campaign.dailyBudget, locale, 'SAR')}
          <span className="ms-1 text-xs font-normal text-slate-400">/day</span>
        </span>
        <PacingBar pacing={campaign.metrics.spendPacing} />
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {modeLabel[campaign.optimizerMode]}
        </span>
      </div>
    </div>
  );
}

// ─── Campaign Overview card ───────────────────────────────────────────────────

interface CampaignOverviewProps {
  campaigns: DashboardCampaign[];
}

export function CampaignOverview({ campaigns }: CampaignOverviewProps) {
  const t = useTranslations('dashboard');
  const tC = useTranslations('campaigns');
  const locale = useLocale();

  const active = campaigns.filter((c) => c.status === 'ACTIVE');
  const rest   = campaigns.filter((c) => c.status !== 'ACTIVE');
  const sorted = [...active, ...rest];

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('campaignOverview')}
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
            {tC('activeCount', { count: active.length })}
          </span>
        </div>
        <Link
          href="/campaigns"
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t('seeAllCampaigns')} →
        </Link>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-slate-100 px-5 py-2 dark:border-slate-700/50">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{t('performance')}</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{t('budget')}</span>
      </div>

      {/* Rows */}
      {sorted.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-400">{tC('subtitle')}</p>
      ) : (
        sorted.map((c) => (
          <CampaignRow key={c.id} campaign={c} locale={locale} t={t} tC={tC} />
        ))
      )}
    </div>
  );
}
