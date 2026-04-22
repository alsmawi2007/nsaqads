'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout/page-container';
import { FullPageSpinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import { useAuthStore } from '@/lib/stores/auth.store';
import { settingsApi, SETTINGS_DEFAULTS, type OptimizerSettings } from '@/lib/api/settings';
import { OptimizerSettingsForm } from '@/features/settings/optimizer-settings';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const { activeOrg } = useAuthStore();
  const orgId = activeOrg?.id ?? '';

  const { data: serverSettings, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings', orgId],
    queryFn: () => settingsApi.getOptimizerSettings(orgId),
    enabled: !!orgId,
  });

  // initialSettings tracks what was last saved (for dirty detection)
  const [initialSettings, setInitialSettings] = useState<OptimizerSettings>(SETTINGS_DEFAULTS);
  const [form, setForm] = useState<OptimizerSettings>(SETTINGS_DEFAULTS);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (serverSettings) {
      setInitialSettings(serverSettings);
      setForm(serverSettings);
    }
  }, [serverSettings]);

  const save = useMutation({
    mutationFn: (settings: OptimizerSettings) =>
      settingsApi.updateOptimizerSettings(orgId, settings),
    onSuccess: (_data, variables) => {
      setInitialSettings(variables);
      setSavedOk(true);
      setSaveError(false);
      setTimeout(() => setSavedOk(false), 3000);
    },
    onError: () => {
      setSaveError(true);
      setSavedOk(false);
    },
  });

  if (isLoading) return <FullPageSpinner />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  return (
    <PageContainer className="max-w-2xl gap-5">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {t('title')}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          {t('subtitle')}
        </p>
      </div>

      {/* ── Settings form ───────────────────────────────────────────────── */}
      <OptimizerSettingsForm
        initialSettings={initialSettings}
        form={form}
        setForm={setForm}
        isSaving={save.isPending}
        savedOk={savedOk}
        saveError={saveError}
        onSave={(settings) => save.mutate(settings)}
      />

    </PageContainer>
  );
}
