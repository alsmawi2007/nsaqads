import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WizardInput } from '../api/types';

export const WIZARD_STEPS = [
  'basics',
  'platforms',
  'audience',
  'schedule',
  'creative',
  'review',
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number];

// Wizard state mirrors WizardInput but allows partial values mid-wizard.
// `adAccountIds` is a flat record so it survives JSON persistence.
export interface WizardDraft {
  name: string;
  goal: WizardInput['goal'] | '';
  goalDetail: WizardInput['goalDetail'];
  geography: {
    countries: string[];
    cities?: string[];
    radiusKm?: number;
  };
  audience: {
    ageMin: number;
    ageMax: number;
    genders: WizardInput['audience']['genders'];
    languages?: string[];
    interestTags?: string[];
  };
  budget: WizardInput['budget'];
  timeline: WizardInput['timeline'];
  platformSelection: WizardInput['platformSelection'];
  creativeBrief: WizardInput['creativeBrief'];
}

const TODAY = new Date().toISOString().slice(0, 10);

const INITIAL_DRAFT: WizardDraft = {
  name: '',
  goal: '',
  goalDetail: {},
  geography: { countries: ['SA'] },
  audience: { ageMin: 25, ageMax: 55, genders: ['ALL'] },
  budget: { totalBudget: 1000, budgetType: 'DAILY', currency: 'USD' },
  timeline: { startDate: TODAY },
  platformSelection: { platforms: [], adAccountIds: {} },
  creativeBrief: { formats: ['IMAGE'] },
};

interface WizardState {
  step: WizardStepKey;
  draft: WizardDraft;
  setStep: (step: WizardStepKey) => void;
  goNext: () => void;
  goBack: () => void;
  patch: (partial: Partial<WizardDraft>) => void;
  patchPlatformSelection: (partial: Partial<WizardInput['platformSelection']>) => void;
  reset: () => void;
}

export const useWizardStore = create<WizardState>()(
  persist(
    (set, get) => ({
      step: 'basics',
      draft: INITIAL_DRAFT,

      setStep: (step) => set({ step }),

      goNext: () => {
        const idx = WIZARD_STEPS.indexOf(get().step);
        if (idx < WIZARD_STEPS.length - 1) set({ step: WIZARD_STEPS[idx + 1]! });
      },

      goBack: () => {
        const idx = WIZARD_STEPS.indexOf(get().step);
        if (idx > 0) set({ step: WIZARD_STEPS[idx - 1]! });
      },

      patch: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),

      patchPlatformSelection: (partial) =>
        set((s) => ({
          draft: {
            ...s.draft,
            platformSelection: { ...s.draft.platformSelection, ...partial },
          },
        })),

      reset: () => set({ step: 'basics', draft: INITIAL_DRAFT }),
    }),
    {
      name: 'adari-wizard',
      partialize: (state) => ({ step: state.step, draft: state.draft }),
    },
  ),
);

// Build the API payload from the draft. Caller must ensure draft is valid.
export function buildWizardInput(draft: WizardDraft): WizardInput {
  if (!draft.goal) throw new Error('goal required');
  return {
    name: draft.name,
    goal: draft.goal,
    goalDetail: draft.goalDetail,
    geography: draft.geography,
    audience: draft.audience,
    budget: draft.budget,
    timeline: draft.timeline,
    platformSelection: draft.platformSelection,
    creativeBrief: draft.creativeBrief,
  };
}
