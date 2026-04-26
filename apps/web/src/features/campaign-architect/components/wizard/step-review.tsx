'use client';

import { useTranslations } from 'next-intl';
import { Toggle } from '@/components/ui/toggle';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { useWizardStore } from '../../store/wizard.store';

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-700 dark:text-slate-200">{value || '—'}</dd>
    </div>
  );
}

interface StepReviewProps {
  acknowledged: boolean;
  onAcknowledgeChange: (next: boolean) => void;
}

export function StepReview({ acknowledged, onAcknowledgeChange }: StepReviewProps) {
  const t = useTranslations('campaignArchitect');
  const draft = useWizardStore((s) => s.draft);

  const goalLabel = draft.goal
    ? t(`goal_${draft.goal}` as Parameters<typeof t>[0])
    : '—';

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('review_section_basics')}>
        <Row label={t('field_name')} value={draft.name} />
        <Row label={t('field_goal')} value={goalLabel} />
      </Section>

      <Section title={t('review_section_platforms')}>
        <div className="col-span-full flex flex-wrap gap-2">
          {draft.platformSelection.platforms.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            draft.platformSelection.platforms.map((p) => (
              <PlatformBadge key={p} platform={p} />
            ))
          )}
        </div>
      </Section>

      <Section title={t('review_section_audience')}>
        <Row
          label={t('field_countries')}
          value={draft.geography.countries.join(', ')}
        />
        <Row
          label={t('field_age_min') + ' / ' + t('field_age_max')}
          value={`${draft.audience.ageMin}–${draft.audience.ageMax}`}
        />
        <Row
          label={t('field_genders')}
          value={draft.audience.genders
            .map((g) => t(`gender_${g}` as Parameters<typeof t>[0]))
            .join(', ')}
        />
        <Row
          label={t('field_languages')}
          value={draft.audience.languages?.join(', ') ?? '—'}
        />
      </Section>

      <Section title={t('review_section_schedule')}>
        <Row
          label={t('field_total_budget')}
          value={
            <span>
              <bdi>
                {draft.budget.totalBudget} {draft.budget.currency}
              </bdi>{' '}
              ·{' '}
              {t(
                `budget_${draft.budget.budgetType}` as Parameters<typeof t>[0],
              )}
            </span>
          }
        />
        <Row
          label={t('field_start_date') + ' → ' + t('field_end_date')}
          value={
            <bdi>
              {draft.timeline.startDate}
              {draft.timeline.endDate ? ` → ${draft.timeline.endDate}` : ''}
            </bdi>
          }
        />
      </Section>

      <Section title={t('review_section_creative')}>
        <Row
          label={t('field_formats')}
          value={draft.creativeBrief.formats
            .map((f) => t(`format_${f}` as Parameters<typeof t>[0]))
            .join(', ')}
        />
        <Row
          label={t('field_landing')}
          value={draft.creativeBrief.landingUrl ?? '—'}
        />
        <Row
          label={t('field_pixel')}
          value={draft.creativeBrief.pixelInstalled ? '✓' : '—'}
        />
      </Section>

      <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-700/40 dark:bg-brand-900/10">
        <Toggle
          checked={acknowledged}
          onChange={onAcknowledgeChange}
          label={t('review_check_label')}
        />
      </div>
    </div>
  );
}
