'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/lib/stores/auth.store';
import { adAccountsApi, type AdAccount } from '@/lib/api/ad-accounts';
import { PLATFORM_META, PLATFORM_ORDER } from '@/features/provider-configs/platform-meta';
import { ConnectedAccountCard } from '@/features/ad-accounts/connected-account-card';
import { ConnectPlatformCard } from '@/features/ad-accounts/connect-platform-card';
import { cn } from '@/lib/utils/cn';

type Tab = 'tracked' | 'available';

export default function AdAccountsPage() {
  const t = useTranslations('adAccounts');
  const { user, activeOrg } = useAuthStore();
  const qc = useQueryClient();
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

  const [tab, setTab]               = useState<Tab>('tracked');
  const [query, setQuery]           = useState('');
  const [selected, setSelected]     = useState<Set<string>>(new Set());

  const orgId = activeOrg?.id;
  const canManage = activeOrg?.role === 'OWNER' || activeOrg?.role === 'ADMIN';

  const { data: accounts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['ad-accounts', orgId],
    queryFn:  () => adAccountsApi.list(orgId!),
    enabled:  !!orgId,
  });

  const bulkTrack = useMutation({
    mutationFn: ({ ids, isTracked }: { ids: string[]; isTracked: boolean }) =>
      adAccountsApi.bulkSetTracked(orgId!, ids, isTracked),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['ad-accounts', orgId] });
    },
  });

  const { tracked, available, counts } = useMemo(() => {
    const tracked: AdAccount[]   = [];
    const available: AdAccount[] = [];
    for (const a of accounts) {
      (a.isTracked ? tracked : available).push(a);
    }
    return { tracked, available, counts: { tracked: tracked.length, available: available.length } };
  }, [accounts]);

  const filteredAvailable = useMemo(() => {
    if (!query.trim()) return available;
    const q = query.trim().toLowerCase();
    return available.filter((a) =>
      (a.name ?? '').toLowerCase().includes(q) ||
      a.externalId.toLowerCase().includes(q) ||
      a.platform.toLowerCase().includes(q),
    );
  }, [available, query]);

  if (!user || !activeOrg) return <FullPageSpinner />;
  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  const connectablePlatforms = PLATFORM_ORDER.filter(
    (p) => PLATFORM_META[p].implemented && PLATFORM_META[p].redirectCallbackWired,
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(filteredAvailable.map((a) => a.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  return (
    <PageContainer className="max-w-6xl gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle', { org: activeOrg.name })}
        </p>
      </header>

      {/* OAuth callback banner */}
      {callbackBanner?.kind === 'success' && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          <div>
            <p className="font-semibold">{t('callback.successTitle', { platform: callbackBanner.platform })}</p>
            <p className="mt-0.5">{t('callback.successBody', { count: callbackBanner.accounts })}</p>
            {callbackBanner.accounts > 1 && (
              <p className="mt-1 italic">{t('callback.bulkHint')}</p>
            )}
          </div>
          <button type="button" onClick={dismissBanner} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" aria-label={t('callback.dismiss')}>×</button>
        </div>
      )}
      {callbackBanner?.kind === 'error' && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          <div>
            <p className="font-semibold">{t('callback.errorTitle', { platform: callbackBanner.platform })}</p>
            <p className="mt-0.5 break-all">{callbackBanner.message}</p>
          </div>
          <button type="button" onClick={dismissBanner} className="rounded p-1 text-red-700 hover:bg-red-100" aria-label={t('callback.dismiss')}>×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
        <TabButton active={tab === 'tracked'}   onClick={() => setTab('tracked')}>
          {t('tabs.tracked')} <span className="ms-1 text-xs opacity-70">({counts.tracked})</span>
        </TabButton>
        <TabButton active={tab === 'available'} onClick={() => setTab('available')}>
          {t('tabs.available')} <span className="ms-1 text-xs opacity-70">({counts.available})</span>
        </TabButton>
      </div>

      {/* TRACKED tab */}
      {tab === 'tracked' && (
        <section className="flex flex-col gap-3">
          {tracked.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('tracked.empty')}</p>
              {counts.available > 0 && (
                <Button variant="primary" size="sm" className="mt-3" onClick={() => setTab('available')}>
                  {t('tracked.gotoAvailable', { count: counts.available })}
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {tracked.map((a) => <ConnectedAccountCard key={a.id} account={a} />)}
            </div>
          )}
        </section>
      )}

      {/* AVAILABLE tab */}
      {tab === 'available' && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('available.searchPlaceholder')}
              className="h-9 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('available.showing', { count: filteredAvailable.length, total: counts.available })}
            </p>
          </div>

          {canManage && filteredAvailable.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/40">
              <div className="flex items-center gap-2">
                <button type="button" onClick={selectAllVisible} className="font-medium text-brand-600 hover:underline">
                  {t('bulk.selectAll')}
                </button>
                {selected.size > 0 && (
                  <button type="button" onClick={clearSelection} className="text-slate-500 hover:underline">
                    {t('bulk.clear')}
                  </button>
                )}
                <span className="text-slate-500">{t('bulk.selected', { count: selected.size })}</span>
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={selected.size === 0}
                loading={bulkTrack.isPending}
                onClick={() => bulkTrack.mutate({ ids: Array.from(selected), isTracked: true })}
              >
                {t('bulk.trackSelected', { count: selected.size })}
              </Button>
            </div>
          )}

          {filteredAvailable.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {query ? t('available.noMatch') : t('available.empty')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {filteredAvailable.map((a) => (
                <AvailableRow
                  key={a.id}
                  account={a}
                  selected={selected.has(a.id)}
                  onToggleSelect={() => toggleSelected(a.id)}
                  canManage={canManage}
                  onTrack={() => bulkTrack.mutate({ ids: [a.id], isTracked: true })}
                  busy={bulkTrack.isPending}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Connect a new platform (always visible at the bottom) */}
      {canManage && (
        <section className="mt-6 flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t('connect.sectionTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('connect.sectionHint')}</p>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
          : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      {children}
    </button>
  );
}

interface AvailableRowProps {
  account:        AdAccount;
  selected:       boolean;
  onToggleSelect: () => void;
  canManage:      boolean;
  onTrack:        () => void;
  busy:           boolean;
}

function AvailableRow({ account, selected, onToggleSelect, canManage, onTrack, busy }: AvailableRowProps) {
  const t = useTranslations('adAccounts');
  const meta = PLATFORM_META[account.platform];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
      {canManage && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={t('available.selectRow', { name: account.name ?? account.externalId })}
          className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
        />
      )}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold"
        style={{
          backgroundColor: meta.brandHex,
          color: meta.brandHex === '#FFFC00' ? '#000' : '#fff',
        }}
        aria-hidden
      >
        {meta.displayName.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900 dark:text-slate-100">
          {account.name ?? account.externalId}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {meta.displayName} · {account.externalId}{account.currency ? ` · ${account.currency}` : ''}
        </p>
      </div>
      {account.status === 'MOCK' && <Badge variant="muted">{t('status.MOCK')}</Badge>}
      {canManage && (
        <Button variant="outline" size="sm" onClick={onTrack} loading={busy} disabled={selected}>
          {t('available.trackOne')}
        </Button>
      )}
    </div>
  );
}
