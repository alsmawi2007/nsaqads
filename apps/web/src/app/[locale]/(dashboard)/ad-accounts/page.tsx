'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { useAuthStore } from '@/lib/stores/auth.store';
import { adAccountsApi } from '@/lib/api/ad-accounts';
import { PLATFORM_META, PLATFORM_ORDER } from '@/features/provider-configs/platform-meta';
import { ConnectedAccountCard } from '@/features/ad-accounts/connected-account-card';
import { ConnectPlatformCard } from '@/features/ad-accounts/connect-platform-card';

export default function AdAccountsPage() {
  const t = useTranslations('adAccounts');
  const { user, activeOrg } = useAuthStore();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const pathname     = usePathname();

  const status    = searchParams.get('status');
  const platformQ = searchParams.get('platform');
  const accountsQ = searchParams.get('accounts');
  const messageQ  = searchParams.get('message');

  const callbackBanner =
    status === 'connected' && platformQ
      ? {
          kind: 'success' as const,
          platform: PLATFORM_META[platformQ.toUpperCase() as keyof typeof PLATFORM_META]?.displayName ?? platformQ,
          accounts: accountsQ ? parseInt(accountsQ, 10) : 0,
        }
      : status === 'error' && platformQ
      ? {
          kind: 'error' as const,
          platform: PLATFORM_META[platformQ.toUpperCase() as keyof typeof PLATFORM_META]?.displayName ?? platformQ,
          message: messageQ ?? 'oauth_failed',
        }
      : null;

  function dismissBanner() {
    router.replace(pathname);
  }

  const orgId = activeOrg?.id;
  const canManage = activeOrg?.role === 'OWNER' || activeOrg?.role === 'ADMIN';

  const { data: accounts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['ad-accounts', orgId],
    queryFn:  () => adAccountsApi.list(orgId!),
    enabled:  !!orgId,
  });

  if (!user || !activeOrg) return <FullPageSpinner />;
  if (isLoading) return <FullPageSpinner />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  // Sort accounts: live first (ACTIVE / EXPIRED / ERROR), then MOCK demo data.
  const sorted = [...accounts].sort((a, b) => {
    const aMock = a.status === 'MOCK' ? 1 : 0;
    const bMock = b.status === 'MOCK' ? 1 : 0;
    return aMock - bMock;
  });

  const connectablePlatforms = PLATFORM_ORDER.filter(
    (p) => PLATFORM_META[p].implemented && PLATFORM_META[p].redirectCallbackWired,
  );

  return (
    <PageContainer className="max-w-5xl gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle', { org: activeOrg.name })}
        </p>
      </header>

      {/* Callback banner */}
      {callbackBanner?.kind === 'success' && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          <div>
            <p className="font-semibold">
              {t('callback.successTitle', { platform: callbackBanner.platform })}
            </p>
            <p className="mt-0.5">{t('callback.successBody', { count: callbackBanner.accounts })}</p>
          </div>
          <button
            type="button"
            onClick={dismissBanner}
            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
            aria-label={t('callback.dismiss')}
          >×</button>
        </div>
      )}
      {callbackBanner?.kind === 'error' && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          <div>
            <p className="font-semibold">
              {t('callback.errorTitle', { platform: callbackBanner.platform })}
            </p>
            <p className="mt-0.5 break-all">{callbackBanner.message}</p>
          </div>
          <button
            type="button"
            onClick={dismissBanner}
            className="rounded p-1 text-red-700 hover:bg-red-100"
            aria-label={t('callback.dismiss')}
          >×</button>
        </div>
      )}

      {/* Connected accounts */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {t('connected.title', { count: accounts.length })}
        </h2>
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('connected.empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sorted.map((a) => <ConnectedAccountCard key={a.id} account={a} />)}
          </div>
        )}
      </section>

      {/* Connect a new platform */}
      {canManage && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('connect.sectionTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t('connect.sectionHint')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {connectablePlatforms.map((p) => (
              <ConnectPlatformCard key={p} platform={p} />
            ))}
          </div>
        </section>
      )}

      {!canManage && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {t('viewerHint')}
        </div>
      )}
    </PageContainer>
  );
}
