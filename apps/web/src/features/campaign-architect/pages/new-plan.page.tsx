'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { useRouter } from '@/lib/i18n/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import { campaignArchitectApi } from '../api/client';
import { buildWizardInput, useWizardStore, WIZARD_STEPS } from '../store/wizard.store';
import { WizardShell } from '../components/wizard/wizard-shell';
import { StepBasics, isStepBasicsValid } from '../components/wizard/step-basics';
import { StepPlatforms, isStepPlatformsValid } from '../components/wizard/step-platforms';
import { StepAudience, isStepAudienceValid } from '../components/wizard/step-audience';
import { StepScheduleBudget, isStepScheduleBudgetValid } from '../components/wizard/step-schedule-budget';
import { StepCreative, isStepCreativeValid } from '../components/wizard/step-creative';
import { StepReview } from '../components/wizard/step-review';

export function NewPlanPage() {
  const t = useTranslations('campaignArchitect');
  const router = useRouter();
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';

  const step = useWizardStore((s) => s.step);
  const draft = useWizardStore((s) => s.draft);
  const goNext = useWizardStore((s) => s.goNext);
  const reset = useWizardStore((s) => s.reset);

  const [acknowledged, setAcknowledged] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => campaignArchitectApi.createPlan(orgId, buildWizardInput(draft)),
    onSuccess: (plan) => {
      reset();
      setAcknowledged(false);
      router.push(`/campaign-architect/${plan.id}`);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Failed to create plan';
      setSubmitError(message);
    },
  });

  const isFinal = step === 'review';
  const stepIndex = WIZARD_STEPS.indexOf(step);

  const stepValid = (() => {
    switch (step) {
      case 'basics':
        return isStepBasicsValid({ name: draft.name, goal: draft.goal });
      case 'platforms':
        return isStepPlatformsValid({ platformSelection: draft.platformSelection });
      case 'audience':
        return isStepAudienceValid({
          geography: draft.geography,
          audience: draft.audience,
        });
      case 'schedule':
        return isStepScheduleBudgetValid({
          budget: draft.budget,
          timeline: draft.timeline,
        });
      case 'creative':
        return isStepCreativeValid({ creativeBrief: draft.creativeBrief });
      case 'review':
        return acknowledged;
      default:
        return false;
    }
  })();

  function handleContinue() {
    if (!stepValid) return;
    if (isFinal) {
      setSubmitError(null);
      createMutation.mutate();
    } else {
      goNext();
    }
  }

  return (
    <PageContainer className="gap-5">
      <PageHeader title={t('wizard_title')} subtitle={t('wizard_subtitle')} />

      <WizardShell
        canContinue={stepValid && !createMutation.isPending}
        onContinue={handleContinue}
        isFinal={isFinal}
        isSubmitting={createMutation.isPending}
      >
        {step === 'basics' && <StepBasics />}
        {step === 'platforms' && <StepPlatforms />}
        {step === 'audience' && <StepAudience />}
        {step === 'schedule' && <StepScheduleBudget />}
        {step === 'creative' && <StepCreative />}
        {step === 'review' && (
          <StepReview acknowledged={acknowledged} onAcknowledgeChange={setAcknowledged} />
        )}
      </WizardShell>

      {submitError && stepIndex === WIZARD_STEPS.length - 1 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/10">
          <div className="px-5 py-3 text-xs text-red-700 dark:text-red-400">{submitError}</div>
        </Card>
      )}
    </PageContainer>
  );
}
