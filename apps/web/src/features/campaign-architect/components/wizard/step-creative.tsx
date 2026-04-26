'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils/cn';
import { useWizardStore } from '../../store/wizard.store';
import type { CreativeFormat } from '../../api/types';

const FORMATS: CreativeFormat[] = ['IMAGE', 'VIDEO', 'CAROUSEL', 'COLLECTION'];

export function StepCreative() {
  const t = useTranslations('campaignArchitect');
  const draft = useWizardStore((s) => s.draft);
  const patch = useWizardStore((s) => s.patch);

  const brief = draft.creativeBrief;

  function toggleFormat(f: CreativeFormat) {
    const has = brief.formats.includes(f);
    const next = has ? brief.formats.filter((x) => x !== f) : [...brief.formats, f];
    patch({
      creativeBrief: { ...brief, formats: next.length === 0 ? [f] : next },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Formats */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('field_formats')}
        </span>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => {
            const isOn = brief.formats.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFormat(f)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  isOn
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-300'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {t(`format_${f}` as Parameters<typeof t>[0])}
              </button>
            );
          })}
        </div>
      </div>

      <Input
        label={t('field_headline')}
        placeholder={t('field_headline_placeholder')}
        maxLength={120}
        value={brief.headline ?? ''}
        onChange={(e) =>
          patch({ creativeBrief: { ...brief, headline: e.target.value || undefined } })
        }
      />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="ca-creative-desc"
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          {t('field_description')}
        </label>
        <textarea
          id="ca-creative-desc"
          rows={2}
          maxLength={500}
          placeholder={t('field_description_placeholder')}
          value={brief.description ?? ''}
          onChange={(e) =>
            patch({ creativeBrief: { ...brief, description: e.target.value || undefined } })
          }
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('field_cta')}
          placeholder="SHOP_NOW"
          maxLength={40}
          value={brief.cta ?? ''}
          onChange={(e) =>
            patch({ creativeBrief: { ...brief, cta: e.target.value || undefined } })
          }
        />
        <Input
          type="url"
          label={t('field_landing')}
          placeholder={t('field_landing_placeholder')}
          value={brief.landingUrl ?? ''}
          onChange={(e) =>
            patch({ creativeBrief: { ...brief, landingUrl: e.target.value || undefined } })
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('field_pixel')}
          </p>
        </div>
        <Toggle
          checked={Boolean(brief.pixelInstalled)}
          onChange={(checked) =>
            patch({ creativeBrief: { ...brief, pixelInstalled: checked } })
          }
        />
      </div>
    </div>
  );
}

export function isStepCreativeValid(draft: {
  creativeBrief: { formats: string[]; landingUrl?: string };
}): boolean {
  if (draft.creativeBrief.formats.length === 0) return false;
  if (draft.creativeBrief.landingUrl) {
    try {
      new URL(draft.creativeBrief.landingUrl);
    } catch {
      return false;
    }
  }
  return true;
}
