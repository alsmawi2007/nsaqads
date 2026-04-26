'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { PlatformBadge } from '@/components/shared/platform-badge';
import { cn } from '@/lib/utils/cn';
import { useWizardStore } from '../../store/wizard.store';
import { campaignArchitectApi } from '../../api/client';
import type { Platform } from '../../api/types';

const PHASE_1_PLATFORMS: Platform[] = ['META', 'GOOGLE_ADS'];

export function StepPlatforms() {
  const t = useTranslations('campaignArchitect');
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';

  const draft = useWizardStore((s) => s.draft);
  const patchPS = useWizardStore((s) => s.patchPlatformSelection);

  const { data: adAccounts = [], isLoading } = useQuery({
    queryKey: ['ad-accounts', orgId],
    queryFn: () => campaignArchitectApi.listAdAccounts(orgId),
    enabled: !!orgId,
  });

  const selected = new Set(draft.platformSelection.platforms);
  const accountsByPlatform = new Map<Platform, typeof adAccounts>();
  for (const acc of adAccounts) {
    if (!accountsByPlatform.has(acc.platform)) accountsByPlatform.set(acc.platform, []);
    accountsByPlatform.get(acc.platform)!.push(acc);
  }

  function togglePlatform(p: Platform) {
    const next = new Set(selected);
    const nextAccounts = { ...draft.platformSelection.adAccountIds };

    if (next.has(p)) {
      next.delete(p);
      delete nextAccounts[p];
    } else {
      next.add(p);
      // Auto-select first ad account if available
      const first = accountsByPlatform.get(p)?.[0];
      if (first) nextAccounts[p] = first.id;
    }

    patchPS({
      platforms: Array.from(next),
      adAccountIds: nextAccounts,
    });
  }

  function setAccount(p: Platform, accountId: string) {
    patchPS({
      adAccountIds: { ...draft.platformSelection.adAccountIds, [p]: accountId },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('field_platforms_help')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PHASE_1_PLATFORMS.map((p) => {
          const isOn = selected.has(p);
          const accounts = accountsByPlatform.get(p) ?? [];
          const noAccounts = accounts.length === 0;

          return (
            <div
              key={p}
              className={cn(
                'flex flex-col gap-3 rounded-xl border p-4 transition-colors',
                isOn
                  ? 'border-brand-500 bg-brand-50/50 dark:border-brand-400 dark:bg-brand-900/10'
                  : 'border-slate-200 dark:border-slate-700',
              )}
            >
              <button
                type="button"
                onClick={() => togglePlatform(p)}
                disabled={noAccounts}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg text-start',
                  noAccounts && 'opacity-60',
                )}
              >
                <PlatformBadge platform={p} />
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border-2',
                    isOn
                      ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-400'
                      : 'border-slate-300 dark:border-slate-600',
                  )}
                  aria-hidden
                >
                  {isOn && (
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </button>

              {isOn && (
                <Select
                  value={draft.platformSelection.adAccountIds[p] ?? ''}
                  onChange={(e) => setAccount(p, e.target.value)}
                  label={t('field_adAccount_for', { platform: p })}
                >
                  <option value="">{t('field_adAccount_none')}</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name ?? acc.externalId}
                      {acc.currency ? ` · ${acc.currency}` : ''}
                    </option>
                  ))}
                </Select>
              )}

              {noAccounts && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No ad account connected for this platform.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function isStepPlatformsValid(draft: {
  platformSelection: { platforms: string[]; adAccountIds: Record<string, string> };
}): boolean {
  const ps = draft.platformSelection;
  if (ps.platforms.length === 0) return false;
  return ps.platforms.every((p) => Boolean(ps.adAccountIds[p]));
}
