'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import { useWizardStore, WIZARD_STEPS, type WizardStepKey } from '../../store/wizard.store';

const STEP_LABEL_KEY: Record<WizardStepKey, string> = {
  basics: 'step_basics',
  platforms: 'step_platforms',
  audience: 'step_audience',
  schedule: 'step_schedule',
  creative: 'step_creative',
  review: 'step_review',
};

const STEP_DESC_KEY: Record<WizardStepKey, string> = {
  basics: 'step_basics_desc',
  platforms: 'step_platforms_desc',
  audience: 'step_audience_desc',
  schedule: 'step_schedule_desc',
  creative: 'step_creative_desc',
  review: 'step_review_desc',
};

interface WizardShellProps {
  children: React.ReactNode;
  canContinue: boolean;
  onContinue: () => void;
  isFinal: boolean;
  isSubmitting: boolean;
}

export function WizardShell({
  children,
  canContinue,
  onContinue,
  isFinal,
  isSubmitting,
}: WizardShellProps) {
  const t = useTranslations('campaignArchitect');
  const step = useWizardStore((s) => s.step);
  const goBack = useWizardStore((s) => s.goBack);

  const stepIndex = WIZARD_STEPS.indexOf(step);
  const totalSteps = WIZARD_STEPS.length;

  const stepHeading = useMemo(
    () => t(STEP_LABEL_KEY[step] as Parameters<typeof t>[0]),
    [t, step],
  );
  const stepDesc = useMemo(
    () => t(STEP_DESC_KEY[step] as Parameters<typeof t>[0]),
    [t, step],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Progress strip */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{t('wizard_step_count', { current: stepIndex + 1, total: totalSteps })}</span>
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {stepHeading}
          </span>
        </div>
        <div className="flex gap-1">
          {WIZARD_STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i < stepIndex
                  ? 'bg-brand-600'
                  : i === stepIndex
                    ? 'bg-brand-500'
                    : 'bg-slate-200 dark:bg-slate-700',
              )}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <Card>
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {stepHeading}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{stepDesc}</p>
        </div>
        <div className="px-6 py-5">{children}</div>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={goBack}
          disabled={stepIndex === 0 || isSubmitting}
        >
          {t('wizard_back')}
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          loading={isSubmitting}
        >
          {isFinal
            ? isSubmitting
              ? t('creatingPlan')
              : t('wizard_finish')
            : t('wizard_next')}
        </Button>
      </div>
    </div>
  );
}
