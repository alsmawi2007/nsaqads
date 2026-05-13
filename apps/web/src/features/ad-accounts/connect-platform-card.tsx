'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/auth.store';
import { providerConfigsApi, type ProviderPlatform } from '@/lib/api/provider-configs';
import { PLATFORM_META } from '@/features/provider-configs/platform-meta';

interface Props {
  platform: ProviderPlatform;
}

// One platform card on the "Connect a new account" rail. Triggers the same
// OAuth-start path that the system-admin Provider Configs page uses. If the
// system hasn't configured the underlying ProviderConfig yet, the API will
// reject and we surface that error inline so the user knows it's an admin
// problem, not theirs.
export function ConnectPlatformCard({ platform }: Props) {
  const t = useTranslations('adAccounts');
  const { activeOrg } = useAuthStore();
  const meta = PLATFORM_META[platform];
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => providerConfigsApi.oauthStart(activeOrg!.id, platform),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: { message?: string }) => {
      setErrorMessage(err.message ?? 'connect_failed');
    },
  });

  const supported = meta.implemented && meta.redirectCallbackWired;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold"
          style={{
            backgroundColor: meta.brandHex,
            color: meta.brandHex === '#FFFC00' ? '#000' : '#fff',
          }}
          aria-hidden
        >
          {meta.displayName.charAt(0)}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{meta.displayName}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {supported ? t('connect.readyHint') : t('connect.comingSoon')}
          </p>
        </div>
      </div>

      {errorMessage && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      <Button
        variant={supported ? 'primary' : 'outline'}
        size="sm"
        onClick={() => {
          setErrorMessage(null);
          connect.mutate();
        }}
        disabled={!supported}
        loading={connect.isPending}
      >
        {supported ? t('connect.action') : t('connect.unavailable')}
      </Button>
    </div>
  );
}
