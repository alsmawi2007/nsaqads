'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { campaignsApi, type CampaignPhase } from '@/lib/api/campaigns';

interface Props {
  orgId:        string;
  campaignId:   string;
  currentPhase: CampaignPhase;
  canManage:    boolean;
}

const PHASES: CampaignPhase[] = ['LEARNING', 'STABLE', 'SCALING', 'DEGRADED'];

// Inline panel rendered on the campaign detail page. Lets an ADMIN move a
// campaign between optimizer phases for activation testing — the optimizer
// holds back on LEARNING by design, so QA needs a way to lift a freshly-
// synced campaign out of LEARNING without faking the underlying metrics.
// The destructive nature is signaled by the amber warning band; every save
// is audit-logged on the backend with the user-supplied reason.
export function PhaseOverridePanel({ orgId, campaignId, currentPhase, canManage }: Props) {
  const t = useTranslations('campaigns.phaseOverride');
  const qc = useQueryClient();
  const [phase, setPhase]   = useState<CampaignPhase>(currentPhase);
  const [reason, setReason] = useState('');
  const [error, setError]   = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => campaignsApi.setPhase(orgId, campaignId, phase, reason.trim()),
    onSuccess: () => {
      setSavedAt(new Date().toLocaleTimeString());
      setReason('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['campaign', orgId, campaignId] });
      qc.invalidateQueries({ queryKey: ['activation-lab', orgId] });
    },
    onError: (err: { message?: string }) => {
      setError(err.message ?? 'phase_override_failed');
    },
  });

  const dirty       = phase !== currentPhase;
  const reasonValid = reason.trim().length >= 3;
  const disabled    = !canManage || !dirty || !reasonValid;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/30 p-5 dark:border-amber-700/40 dark:bg-amber-900/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900 dark:bg-amber-800 dark:text-amber-200" aria-hidden>!</span>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h2>
          </div>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{t('warning')}</p>
        </div>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900 dark:bg-amber-800 dark:text-amber-200">
          {t('testingOnly')}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Select
          id="phase-override-select"
          label={t('newPhase')}
          value={phase}
          onChange={(e) => setPhase(e.target.value as CampaignPhase)}
          disabled={!canManage || save.isPending}
        >
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {t(`phase.${p}`)}
            </option>
          ))}
        </Select>
        <div className="md:col-span-2">
          <label htmlFor="phase-reason" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('reasonLabel')}
          </label>
          <input
            id="phase-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reasonPlaceholder')}
            disabled={!canManage || save.isPending}
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          {reason.length > 0 && !reasonValid && (
            <p className="mt-1 text-xs text-red-500">{t('reasonTooShort')}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('current', { phase: t(`phase.${currentPhase}`) })}
          {savedAt && <span className="ms-2 text-emerald-600 dark:text-emerald-400">{t('savedAt', { time: savedAt })}</span>}
        </p>
        {canManage ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={disabled}
          >
            {t('apply')}
          </Button>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('adminOnly')}</p>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
