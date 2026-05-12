'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  providerConfigsApi,
  type ProviderPlatform,
  type RedactedProviderConfig,
} from '@/lib/api/provider-configs';
import { PLATFORM_ORDER } from '@/features/provider-configs/platform-meta';
import { ProviderConfigCard } from '@/features/provider-configs/provider-config-card';

export default function ProviderConfigsPage() {
  const t = useTranslations('providerConfigs');
  const { user } = useAuthStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['providerConfigs'],
    queryFn:  () => providerConfigsApi.list(),
    enabled:  !!user?.isSystemAdmin,
  });

  const byPlatform = useMemo(() => {
    const m = new Map<ProviderPlatform, RedactedProviderConfig>();
    (data ?? []).forEach((c) => m.set(c.platform, c));
    return m;
  }, [data]);

  if (!user) return <FullPageSpinner />;

  if (!user.isSystemAdmin) {
    return (
      <PageContainer className="items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-8 py-10 text-center dark:border-slate-700 dark:bg-slate-800">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('forbidden.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('forbidden.body')}</p>
        </div>
      </PageContainer>
    );
  }

  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  return (
    <PageContainer className="max-w-4xl gap-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
      </div>

      {/* Safety banner */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
        {t('safetyBanner')}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-4">
        {PLATFORM_ORDER.map((platform) => (
          <ProviderConfigCard
            key={platform}
            platform={platform}
            config={byPlatform.get(platform) ?? null}
          />
        ))}
      </div>
    </PageContainer>
  );
}
