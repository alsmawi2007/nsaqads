'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useWizardStore } from '../../store/wizard.store';
import type { CampaignGoal } from '../../api/types';

const GOALS: CampaignGoal[] = [
  'AWARENESS',
  'TRAFFIC',
  'ENGAGEMENT',
  'LEADS',
  'SALES',
  'APP_INSTALLS',
];

export function StepBasics() {
  const t = useTranslations('campaignArchitect');
  const draft = useWizardStore((s) => s.draft);
  const patch = useWizardStore((s) => s.patch);

  const goal = draft.goal;

  function setGoal(next: CampaignGoal | '') {
    // Reset goal-specific detail when changing goal
    patch({ goal: next, goalDetail: {} });
  }

  function setDetail<K extends keyof typeof draft.goalDetail>(key: K, raw: string) {
    const num = raw === '' ? undefined : Number(raw);
    patch({ goalDetail: { ...draft.goalDetail, [key]: Number.isFinite(num) ? num : undefined } });
  }

  return (
    <div className="flex flex-col gap-5">
      <Input
        id="ca-name"
        label={t('field_name')}
        placeholder={t('field_name_placeholder')}
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        maxLength={120}
      />

      <div className="flex flex-col gap-1.5">
        <Select
          id="ca-goal"
          label={t('field_goal')}
          value={goal}
          onChange={(e) => setGoal(e.target.value as CampaignGoal | '')}
        >
          <option value="">—</option>
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {t(`goal_${g}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </Select>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('field_goal_help')}</p>
      </div>

      {/* Goal-specific detail fields */}
      {goal === 'SALES' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            type="number"
            min={0}
            step="0.01"
            label={t('field_targetCpa')}
            value={draft.goalDetail.targetCpa ?? ''}
            onChange={(e) => setDetail('targetCpa', e.target.value)}
          />
          <Input
            type="number"
            min={0}
            step="0.1"
            label={t('field_targetRoas')}
            value={draft.goalDetail.targetRoas ?? ''}
            onChange={(e) => setDetail('targetRoas', e.target.value)}
          />
        </div>
      )}
      {goal === 'LEADS' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            type="number"
            min={0}
            label={t('field_targetCpa')}
            value={draft.goalDetail.targetCpa ?? ''}
            onChange={(e) => setDetail('targetCpa', e.target.value)}
          />
          <Input
            type="number"
            min={0}
            label={t('field_targetLeadsPerMonth')}
            value={draft.goalDetail.targetLeadsPerMonth ?? ''}
            onChange={(e) => setDetail('targetLeadsPerMonth', e.target.value)}
          />
        </div>
      )}
      {goal === 'APP_INSTALLS' && (
        <Input
          type="number"
          min={0}
          label={t('field_targetInstallsPerMonth')}
          value={draft.goalDetail.targetInstallsPerMonth ?? ''}
          onChange={(e) => setDetail('targetInstallsPerMonth', e.target.value)}
        />
      )}
      {goal === 'AWARENESS' && (
        <Input
          type="number"
          min={0}
          label={t('field_targetReach')}
          value={draft.goalDetail.targetReach ?? ''}
          onChange={(e) => setDetail('targetReach', e.target.value)}
        />
      )}
      {goal === 'TRAFFIC' && (
        <Input
          type="number"
          min={0}
          label={t('field_targetClicks')}
          value={draft.goalDetail.targetClicks ?? ''}
          onChange={(e) => setDetail('targetClicks', e.target.value)}
        />
      )}
      {goal === 'ENGAGEMENT' && (
        <Input
          type="number"
          min={0}
          label={t('field_targetEngagements')}
          value={draft.goalDetail.targetEngagements ?? ''}
          onChange={(e) => setDetail('targetEngagements', e.target.value)}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ca-notes" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('field_notes')}
        </label>
        <textarea
          id="ca-notes"
          rows={3}
          maxLength={500}
          placeholder={t('field_notes_placeholder')}
          value={draft.goalDetail.notes ?? ''}
          onChange={(e) =>
            patch({ goalDetail: { ...draft.goalDetail, notes: e.target.value || undefined } })
          }
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
        />
      </div>
    </div>
  );
}

// Validation helper
export function isStepBasicsValid(draft: { name: string; goal: string }): boolean {
  return draft.name.trim().length >= 3 && draft.goal !== '';
}
