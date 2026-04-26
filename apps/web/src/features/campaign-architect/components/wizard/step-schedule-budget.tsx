'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useWizardStore } from '../../store/wizard.store';
import type { BudgetType } from '../../api/types';

const BUDGET_TYPES: BudgetType[] = ['DAILY', 'LIFETIME'];
const COMMON_CURRENCIES = ['USD', 'SAR', 'AED', 'EUR', 'GBP', 'KWD'];

export function StepScheduleBudget() {
  const t = useTranslations('campaignArchitect');
  const draft = useWizardStore((s) => s.draft);
  const patch = useWizardStore((s) => s.patch);

  const budget = draft.budget;
  const timeline = draft.timeline;

  return (
    <div className="flex flex-col gap-5">
      {/* Budget block */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          type="number"
          min={1}
          step="0.01"
          label={t('field_total_budget')}
          value={budget.totalBudget}
          onChange={(e) =>
            patch({
              budget: { ...budget, totalBudget: Number(e.target.value) || 0 },
            })
          }
        />
        <Select
          label={t('field_budget_type')}
          value={budget.budgetType}
          onChange={(e) =>
            patch({ budget: { ...budget, budgetType: e.target.value as BudgetType } })
          }
        >
          {BUDGET_TYPES.map((b) => (
            <option key={b} value={b}>
              {t(`budget_${b}` as Parameters<typeof t>[0])}
            </option>
          ))}
        </Select>
        <Select
          label={t('field_currency')}
          value={budget.currency}
          onChange={(e) => patch({ budget: { ...budget, currency: e.target.value } })}
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      {/* Schedule block */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          type="date"
          label={t('field_start_date')}
          value={timeline.startDate}
          onChange={(e) => patch({ timeline: { ...timeline, startDate: e.target.value } })}
        />
        <div className="flex flex-col gap-1.5">
          <Input
            type="date"
            label={t('field_end_date')}
            value={timeline.endDate ?? ''}
            onChange={(e) =>
              patch({ timeline: { ...timeline, endDate: e.target.value || undefined } })
            }
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('field_end_date_optional')}
          </p>
        </div>
      </div>
    </div>
  );
}

export function isStepScheduleBudgetValid(draft: {
  budget: { totalBudget: number; currency: string; budgetType: string };
  timeline: { startDate: string; endDate?: string };
}): boolean {
  if (!(draft.budget.totalBudget > 0)) return false;
  if (draft.budget.currency.length !== 3) return false;
  if (!draft.timeline.startDate) return false;
  if (draft.budget.budgetType === 'LIFETIME' && !draft.timeline.endDate) return false;
  if (draft.timeline.endDate && draft.timeline.endDate < draft.timeline.startDate) return false;
  return true;
}
