'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/auth.store';
import { adAccountsApi, type AdAccount } from '@/lib/api/ad-accounts';
import { PLATFORM_META } from '@/features/provider-configs/platform-meta';

interface Props {
  account: AdAccount;
}

export function ConnectedAccountCard({ account }: Props) {
  const t = useTranslations('adAccounts');
  const { activeOrg } = useAuthStore();
  const qc = useQueryClient();
  const meta = PLATFORM_META[account.platform];
  const canManage = activeOrg?.role === 'OWNER' || activeOrg?.role === 'ADMIN';

  const sync = useMutation({
    mutationFn: () => adAccountsApi.sync(activeOrg!.id, account.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ad-accounts', activeOrg!.id] }),
  });

  const disconnect = useMutation({
    mutationFn: () => adAccountsApi.disconnect(activeOrg!.id, account.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ad-accounts', activeOrg!.id] }),
  });

  const untrack = useMutation({
    mutationFn: () => adAccountsApi.setTracked(activeOrg!.id, account.id, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ad-accounts', activeOrg!.id] }),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold"
            style={{
              backgroundColor: meta.brandHex,
              color: meta.brandHex === '#FFFC00' ? '#000' : '#fff',
            }}
            aria-hidden
          >
            {meta.displayName.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
              {account.name ?? account.externalId}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {meta.displayName} · {account.externalId}
            </p>
          </div>
        </div>
        <StatusBadge status={account.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">{t('summary.currency')}</dt>
          <dd className="font-mono text-slate-800 dark:text-slate-200">{account.currency ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">{t('summary.timezone')}</dt>
          <dd className="text-slate-800 dark:text-slate-200">{account.timezone ?? '—'}</dd>
        </div>
        {account.tokenExpiresAt && (
          <div className="col-span-2">
            <dt className="text-slate-500 dark:text-slate-400">{t('summary.tokenExpires')}</dt>
            <dd className="text-slate-800 dark:text-slate-200">
              {new Date(account.tokenExpiresAt).toLocaleString()}
            </dd>
          </div>
        )}
        {account.errorMessage && (
          <div className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {account.errorMessage}
          </div>
        )}
      </dl>

      {canManage && (
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sync.mutate()}
            loading={sync.isPending}
          >
            {t('actions.sync')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => untrack.mutate()}
            loading={untrack.isPending}
            title={t('actions.untrackHint')}
          >
            {t('actions.untrack')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(t('confirmDisconnect', { name: account.name ?? account.externalId }))) {
                disconnect.mutate();
              }
            }}
            loading={disconnect.isPending}
          >
            {t('actions.disconnect')}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdAccount['status'] }) {
  const t = useTranslations('adAccounts.status');
  const variant =
    status === 'ACTIVE'   ? 'success'
    : status === 'MOCK'    ? 'muted'
    : status === 'EXPIRED' ? 'warning'
    : status === 'ERROR'   ? 'danger'
    : 'muted';
  return <Badge variant={variant as 'success' | 'muted' | 'warning' | 'danger'}>{t(status)}</Badge>;
}
