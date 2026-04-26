'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { useWizardStore } from '../../store/wizard.store';
import type { AudienceGender } from '../../api/types';

const GENDERS: AudienceGender[] = ['ALL', 'MALE', 'FEMALE'];

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseUpperList(raw: string): string[] {
  return parseList(raw).map((s) => s.toUpperCase());
}

export function StepAudience() {
  const t = useTranslations('campaignArchitect');
  const draft = useWizardStore((s) => s.draft);
  const patch = useWizardStore((s) => s.patch);

  const audience = draft.audience;
  const geo = draft.geography;

  function toggleGender(g: AudienceGender) {
    const has = audience.genders.includes(g);
    const next: AudienceGender[] = has
      ? audience.genders.filter((x) => x !== g)
      : [...audience.genders, g];

    patch({
      audience: {
        ...audience,
        // Always at least one
        genders: next.length === 0 ? [g] : next,
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Geography */}
      <Input
        label={t('field_countries')}
        placeholder={t('field_countries_placeholder')}
        value={geo.countries.join(', ')}
        onChange={(e) =>
          patch({ geography: { ...geo, countries: parseUpperList(e.target.value) } })
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('field_cities')}
          placeholder={t('field_cities_placeholder')}
          value={geo.cities?.join(', ') ?? ''}
          onChange={(e) => {
            const cities = parseList(e.target.value);
            patch({
              geography: {
                ...geo,
                cities: cities.length > 0 ? cities : undefined,
                // Drop radius when no cities
                radiusKm: cities.length === 0 ? undefined : geo.radiusKm ?? 50,
              },
            });
          }}
        />
        <Input
          type="number"
          min={1}
          max={500}
          label={t('field_radius')}
          value={geo.radiusKm ?? ''}
          disabled={!geo.cities || geo.cities.length === 0}
          onChange={(e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value);
            patch({ geography: { ...geo, radiusKm: Number.isFinite(v) ? v : undefined } });
          }}
        />
      </div>

      {/* Age */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          type="number"
          min={13}
          max={65}
          label={t('field_age_min')}
          value={audience.ageMin}
          onChange={(e) =>
            patch({ audience: { ...audience, ageMin: Math.max(13, Math.min(65, Number(e.target.value) || 13)) } })
          }
        />
        <Input
          type="number"
          min={13}
          max={65}
          label={t('field_age_max')}
          value={audience.ageMax}
          onChange={(e) =>
            patch({ audience: { ...audience, ageMax: Math.max(13, Math.min(65, Number(e.target.value) || 65)) } })
          }
        />
      </div>

      {/* Genders */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('field_genders')}
        </span>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => {
            const isOn = audience.genders.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGender(g)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  isOn
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-300'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {t(`gender_${g}` as Parameters<typeof t>[0])}
              </button>
            );
          })}
        </div>
      </div>

      {/* Languages */}
      <Input
        label={t('field_languages')}
        placeholder={t('field_languages_placeholder')}
        value={audience.languages?.join(', ') ?? ''}
        onChange={(e) => {
          const langs = parseList(e.target.value);
          patch({
            audience: {
              ...audience,
              languages: langs.length > 0 ? langs : undefined,
            },
          });
        }}
      />

      {/* Interests */}
      <Input
        label={t('field_interests')}
        placeholder={t('field_interests_placeholder')}
        value={audience.interestTags?.join(', ') ?? ''}
        onChange={(e) => {
          const tags = parseList(e.target.value);
          patch({
            audience: {
              ...audience,
              interestTags: tags.length > 0 ? tags : undefined,
            },
          });
        }}
      />
    </div>
  );
}

export function isStepAudienceValid(draft: {
  audience: { ageMin: number; ageMax: number; genders: string[] };
  geography: { countries: string[] };
}): boolean {
  if (draft.geography.countries.length === 0) return false;
  if (draft.audience.genders.length === 0) return false;
  if (draft.audience.ageMin < 13 || draft.audience.ageMax > 65) return false;
  if (draft.audience.ageMin > draft.audience.ageMax) return false;
  return true;
}
