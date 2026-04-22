'use client';

import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { Link } from '@/lib/i18n/navigation';
import type { DashboardAlert } from './mock-data';

// ─── Severity configuration ───────────────────────────────────────────────────

const severityConfig = {
  CRITICAL: {
    dot:    'bg-red-500',
    border: 'border-s-red-500',
    label:  'text-red-600 dark:text-red-400',
    bg:     'bg-red-50 dark:bg-red-900/10',
  },
  WARNING: {
    dot:    'bg-amber-400',
    border: 'border-s-amber-400',
    label:  'text-amber-600 dark:text-amber-400',
    bg:     'bg-amber-50 dark:bg-amber-900/10',
  },
  INFO: {
    dot:    'bg-blue-400',
    border: 'border-s-blue-400',
    label:  'text-blue-600 dark:text-blue-400',
    bg:     '',
  },
} as const;

// ─── Alert row ────────────────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const t = useTranslations('alerts');
  const locale = useLocale();
  const config = severityConfig[alert.severity];

  return (
    <div
      className={cn(
        'flex items-start gap-3 border-s-2 py-3 ps-4 pe-5 transition-colors',
        config.border,
        config.bg,
        !alert.isRead && 'relative',
      )}
    >
      {/* Unread dot */}
      {!alert.isRead && (
        <span className="absolute end-3 top-3 h-1.5 w-1.5 rounded-full bg-brand-600" />
      )}

      {/* Severity dot */}
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', config.dot)} />

      <div className="min-w-0 flex-1">
        {/* Type + campaign */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('text-xs font-semibold', config.label)}>
            {t(`type_${alert.alertType.toLowerCase()}` as Parameters<typeof t>[0])}
          </span>
          {alert.campaignName && (
            <>
              <span className="text-xs text-slate-300 dark:text-slate-600">·</span>
              <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                {alert.campaignName}
              </span>
            </>
          )}
        </div>
        {/* Message */}
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
          {alert.message}
        </p>
        {/* Time */}
        <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
          {formatRelativeTime(alert.createdAt, locale)}
        </p>
      </div>
    </div>
  );
}

// ─── Alerts Widget card ───────────────────────────────────────────────────────

interface AlertsWidgetProps {
  alerts: DashboardAlert[];
}

export function AlertsWidget({ alerts }: AlertsWidgetProps) {
  const t = useTranslations('alerts');
  const tD = useTranslations('dashboard');

  const unreadCount = alerts.filter((a) => !a.isRead).length;

  // Sort: unread first, then by severity (CRITICAL > WARNING > INFO)
  const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  const sorted = [...alerts].sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {tD('recentAlerts')}
          </h2>
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <Link
          href="/alerts"
          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {tD('seeAllAlerts')} →
        </Link>
      </div>

      {/* Alert rows */}
      <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700/50">
        {sorted.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-slate-400">{tD('allClear')}</p>
          </div>
        ) : (
          sorted.map((alert) => <AlertRow key={alert.id} alert={alert} />)
        )}
      </div>

      {/* Footer summary */}
      {sorted.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-700/50">
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            {(['CRITICAL', 'WARNING', 'INFO'] as const).map((sev) => {
              const count = alerts.filter((a) => a.severity === sev).length;
              if (count === 0) return null;
              const cfg = severityConfig[sev];
              return (
                <span key={sev} className="flex items-center gap-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} />
                  <span className={cfg.label}>{count} {t(`severity_${sev.toLowerCase()}` as Parameters<typeof t>[0])}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
