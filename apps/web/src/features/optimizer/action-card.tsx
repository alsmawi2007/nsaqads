/**
 * ActionCard — displays a single optimizer action.
 *
 * Visual hierarchy (top to bottom):
 *   1. Card header: status badge · action type label · trigger badge · timestamp
 *   2. Entity line: campaign/ad set name · platform badge · entity type
 *   3. Explanation block: human-readable reasoning (most prominent element)
 *   4. Before/After diff: ValueDiff component
 *   5. Error message: only for FAILED actions
 *   6. Status notes: context-aware note for PENDING / SKIPPED / ROLLED_BACK
 *   7. CTA row: Approve / Reject for PENDING actions only
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { formatRelativeTime } from '@/lib/utils/format';
import { ValueDiff } from './value-diff';
import type { MockOptimizerAction } from './mock-data';
import type { ActionStatus } from '@/lib/api/optimizer';

// ─── Status config ────────────────────────────────────────────────────────────

const statusConfig: Record<ActionStatus, {
  variant: 'success' | 'warning' | 'danger' | 'muted';
  dotClass: string;
  borderClass: string;
}> = {
  APPLIED:      { variant: 'success', dotClass: 'bg-emerald-500',             borderClass: 'border-s-emerald-500' },
  PENDING:      { variant: 'warning', dotClass: 'bg-amber-400',               borderClass: 'border-s-amber-400' },
  FAILED:       { variant: 'danger',  dotClass: 'bg-red-500',                  borderClass: 'border-s-red-500' },
  SKIPPED:      { variant: 'muted',   dotClass: 'bg-slate-300 dark:bg-slate-600', borderClass: 'border-s-slate-300 dark:border-s-slate-600' },
  ROLLED_BACK:  { variant: 'warning', dotClass: 'bg-orange-400',              borderClass: 'border-s-orange-400' },
};

// ─── Status note (contextual bottom note for non-applied states) ──────────────

// SVG icons for each status note — avoids cross-platform emoji rendering issues

const PendingIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const FailedIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const SkippedIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const RolledBackIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
  </svg>
);

function StatusNote({ status, tKey }: { status: ActionStatus; tKey: string }) {
  const t = useTranslations('optimizer');

  const config: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    pendingNote:    { bg: 'bg-amber-50 dark:bg-amber-900/10',    text: 'text-amber-700 dark:text-amber-300',   icon: <PendingIcon /> },
    failedNote:     { bg: 'bg-red-50 dark:bg-red-900/10',        text: 'text-red-700 dark:text-red-300',       icon: <FailedIcon /> },
    skippedNote:    { bg: 'bg-slate-100 dark:bg-slate-800',      text: 'text-slate-600 dark:text-slate-400',   icon: <SkippedIcon /> },
    rolledBackNote: { bg: 'bg-orange-50 dark:bg-orange-900/10',  text: 'text-orange-700 dark:text-orange-300', icon: <RolledBackIcon /> },
  };

  const c = config[tKey];
  if (!c) return null;

  return (
    <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs', c.bg)}>
      <span className={cn('mt-0.5 shrink-0', c.text)}>{c.icon}</span>
      <span className={cn('leading-relaxed', c.text)}>
        {t(tKey as Parameters<typeof t>[0])}
      </span>
    </div>
  );
}

// ─── Error block ──────────────────────────────────────────────────────────────

function ErrorBlock({ message }: { message: string }) {
  const t = useTranslations('optimizer');
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800/40 dark:bg-red-900/10">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400">
          {t('errorMessage')}
        </p>
        <p className="text-xs font-mono text-red-600 dark:text-red-300 leading-relaxed">
          {message}
        </p>
      </div>
    </div>
  );
}

// ─── ActionCard ───────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: MockOptimizerAction;
  onApprove?: (id: string) => void;
  onReject?:  (id: string) => void;
}

export function ActionCard({ action, onApprove, onReject }: ActionCardProps) {
  const t = useTranslations('optimizer');
  const locale = useLocale();
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const sc = statusConfig[action.status];
  const explanation = locale === 'ar' && action.explanation.ar
    ? action.explanation.ar
    : action.explanation.en;

  // Human-readable action type label
  const actionLabel = t(`action_${action.actionType}` as Parameters<typeof t>[0]);

  // Trigger badge variant
  const triggerVariant: Record<string, 'default' | 'info' | 'muted'> = {
    SCHEDULER: 'muted',
    MANUAL:    'default',
    API:       'info',
  };

  // Status note key
  const statusNoteKey: Partial<Record<ActionStatus, string>> = {
    PENDING:      'pendingNote',
    FAILED:       'failedNote',
    SKIPPED:      'skippedNote',
    ROLLED_BACK:  'rolledBackNote',
  };

  async function handleApprove() {
    setApproving(true);
    await onApprove?.(action.id);
    if (mountedRef.current) setApproving(false);
  }

  async function handleReject() {
    setRejecting(true);
    await onReject?.(action.id);
    if (mountedRef.current) setRejecting(false);
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-slate-200 bg-white',
        'border-s-4',
        'dark:border-slate-700 dark:bg-slate-800',
        sc.borderClass,
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        {/* Status */}
        <Badge variant={sc.variant}>
          <span className={cn('me-1.5 h-1.5 w-1.5 rounded-full', sc.dotClass, 'inline-block')} />
          {t(`status_${action.status.toLowerCase()}` as Parameters<typeof t>[0])}
        </Badge>

        {/* Action type label — prominent */}
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {actionLabel}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Trigger */}
        <Badge variant={triggerVariant[action.triggeredBy] ?? 'muted'}>
          {t(`trigger_${action.triggeredBy.toLowerCase()}` as Parameters<typeof t>[0])}
        </Badge>

        {/* Rule name */}
        {action.ruleName && (
          <span className="hidden text-[11px] text-slate-400 dark:text-slate-500 sm:inline">
            {action.ruleName}
          </span>
        )}

        {/* Timestamp */}
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatRelativeTime(action.createdAt, locale)}
        </span>
      </div>

      {/* ── Entity line ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 dark:border-slate-700/50 dark:bg-slate-900/20">
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

        {/* Explanation — most prominent element */}
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

        {/* Error message — FAILED only */}
        {action.status === 'FAILED' && action.errorMessage && (
          <ErrorBlock message={action.errorMessage} />
        )}

        {/* Contextual status note */}
        {statusNoteKey[action.status] && (
          <StatusNote status={action.status} tKey={statusNoteKey[action.status]!} />
        )}

        {/* Approve / Reject — PENDING only */}
        {action.status === 'PENDING' && (
          <div className="flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <Button
              size="sm"
              variant="primary"
              loading={approving}
              disabled={rejecting}
              onClick={handleApprove}
            >
              {approving ? t('approving') : t('approveAction')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={rejecting}
              disabled={approving}
              onClick={handleReject}
            >
              {rejecting ? t('rejecting') : t('rejectAction')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
