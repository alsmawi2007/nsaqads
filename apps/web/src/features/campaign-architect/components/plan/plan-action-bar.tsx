'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import type { PlanResponse } from '../../api/types';

interface PlanActionBarProps {
  plan: PlanResponse;
  onRegenerate: () => void;
  onApprove: (acknowledgedWarnings: boolean) => void;
  onLaunch?: () => void;  // Phase 2 — display only
  isRegenerating: boolean;
  isApproving: boolean;
}

export function PlanActionBar({
  plan,
  onRegenerate,
  onApprove,
  onLaunch,
  isRegenerating,
  isApproving,
}: PlanActionBarProps) {
  const t = useTranslations('campaignArchitect');

  const hasBlockers = plan.risks.some((r) => r.severity === 'BLOCKER');
  const hasWarnings = plan.risks.some((r) => r.severity === 'WARNING');
  const [acknowledged, setAcknowledged] = useState(false);

  const isDraft = plan.status === 'DRAFT';
  const canApprove = isDraft && !hasBlockers && (!hasWarnings || acknowledged);
  const isApprovedOrAfter = plan.status !== 'DRAFT' && plan.status !== 'ARCHIVED';

  return (
    <div className="sticky bottom-0 z-10 -mx-6 border-t border-slate-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: warning ack */}
        <div className="flex flex-col gap-1">
          {hasBlockers && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {t('plan_blocker_note')}
            </p>
          )}
          {!hasBlockers && hasWarnings && isDraft && (
            <Toggle
              checked={acknowledged}
              onChange={setAcknowledged}
              label={t('plan_warning_ack')}
            />
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {isDraft && (
            <>
              <Button
                variant="outline"
                onClick={onRegenerate}
                loading={isRegenerating}
                disabled={isApproving}
              >
                {isRegenerating ? t('regenerating') : t('plan_action_regenerate')}
              </Button>
              <Button
                onClick={() => onApprove(hasWarnings ? acknowledged : false)}
                disabled={!canApprove || isRegenerating}
                loading={isApproving}
              >
                {t('plan_action_approve')}
              </Button>
            </>
          )}

          {plan.status === 'APPROVED' && onLaunch && (
            <Button onClick={onLaunch}>{t('plan_action_launch')}</Button>
          )}

          {isApprovedOrAfter && plan.status !== 'APPROVED' && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t(`status_${plan.status.toLowerCase()}` as Parameters<typeof t>[0])}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
