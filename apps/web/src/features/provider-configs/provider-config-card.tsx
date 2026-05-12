'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useAuthStore } from '@/lib/stores/auth.store';
import {
  providerConfigsApi,
  type ProviderPlatform,
  type RedactedProviderConfig,
} from '@/lib/api/provider-configs';
import { PLATFORM_META, suggestRedirectUri } from './platform-meta';
import { ProviderConfigForm } from './provider-config-form';

interface ProviderConfigCardProps {
  platform: ProviderPlatform;
  config:   RedactedProviderConfig | null;
}

export function ProviderConfigCard({ platform, config }: ProviderConfigCardProps) {
  const t = useTranslations('providerConfigs');
  const meta = PLATFORM_META[platform];
  const qc = useQueryClient();
  const { activeOrg } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const upsert = useMutation({
    mutationFn: (payload: Parameters<typeof providerConfigsApi.upsert>[1]) =>
      providerConfigsApi.upsert(platform, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providerConfigs'] });
      setEditing(false);
      setSaveError(null);
    },
    onError: (err: { message?: string }) => {
      setSaveError(err.message ?? 'Save failed');
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (next: boolean) => providerConfigsApi.setEnabled(platform, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providerConfigs'] }),
  });

  const connect = useMutation({
    mutationFn: () => {
      if (!activeOrg) throw new Error('no_active_org');
      return providerConfigsApi.oauthStart(activeOrg.id, platform);
    },
    onSuccess: ({ url }) => {
      // Navigate the current window — the platform redirects back to our
      // callback, which redirects to /settings/providers?status=connected
      // (only when meta.redirectCallbackWired is true).
      window.location.href = url;
    },
    onError: (err: { message?: string }) => {
      setConnectError(err.message ?? 'connect_failed');
    },
  });

  const isConfigured = !!config;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: meta.brandHex, color: meta.brandHex === '#FFFC00' ? '#000' : '#fff' }}
            aria-hidden
          >
            {meta.displayName.charAt(0)}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {meta.displayName}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {meta.platform}
              {!meta.implemented && (
                <span className="ms-2">· {t('status.notImplemented')}</span>
              )}
            </p>
          </div>
        </div>
        <StatusBadge isConfigured={isConfigured} isEnabled={!!config?.isEnabled} />
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {!editing && (
          <SummaryView
            config={config}
            platform={platform}
            onEdit={() => {
              setSaveError(null);
              setEditing(true);
            }}
            onToggleEnabled={(next) => toggleEnabled.mutate(next)}
            toggling={toggleEnabled.isPending}
            onConnect={() => {
              setConnectError(null);
              connect.mutate();
            }}
            connecting={connect.isPending}
            connectError={connectError}
          />
        )}
        {editing && (
          <ProviderConfigForm
            config={config}
            platform={platform}
            onSave={(p) => upsert.mutate(p)}
            onCancel={() => {
              setEditing(false);
              setSaveError(null);
            }}
            isSaving={upsert.isPending}
            saveError={saveError}
          />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ isConfigured, isEnabled }: { isConfigured: boolean; isEnabled: boolean }) {
  const t = useTranslations('providerConfigs');
  if (!isConfigured) return <Badge variant="muted">{t('status.notConfigured')}</Badge>;
  if (!isEnabled) return <Badge variant="warning">{t('status.disabled')}</Badge>;
  return <Badge variant="success">{t('status.enabled')}</Badge>;
}

interface SummaryViewProps {
  config:          RedactedProviderConfig | null;
  platform:        ProviderPlatform;
  onEdit:          () => void;
  onToggleEnabled: (next: boolean) => void;
  toggling:        boolean;
  onConnect:       () => void;
  connecting:      boolean;
  connectError:    string | null;
}

function SummaryView({
  config, platform, onEdit, onToggleEnabled, toggling,
  onConnect, connecting, connectError,
}: SummaryViewProps) {
  const t = useTranslations('providerConfigs');
  const suggested = suggestRedirectUri(platform);
  const meta = PLATFORM_META[platform];

  if (!config) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('summary.notConfiguredBody')}
        </p>
        <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-900/40">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('summary.redirectUriToRegister')}
          </p>
          <code className="break-all text-xs text-slate-700 dark:text-slate-300">{suggested}</code>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {meta.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('actions.openDevConsole')} ↗
            </a>
          )}
          <Button variant="primary" size="sm" onClick={onEdit}>
            {t('actions.configure')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Quick toggle */}
      <Toggle
        checked={config.isEnabled}
        disabled={toggling}
        onChange={onToggleEnabled}
        label={t('summary.toggleLabel')}
        description={t('summary.toggleDescription')}
      />

      {/* Field grid */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        <Field label={t('summary.appId')} value={config.appId} mono />
        <Field
          label={t('summary.appSecret')}
          value={config.hasAppSecret
            ? t('summary.secretFingerprint', { last4: config.appSecretLast4 ?? '••••' })
            : t('summary.secretMissing')}
          mono
          muted={!config.hasAppSecret}
        />
        <Field label={t('summary.apiVersion')} value={config.apiVersion ?? meta.apiVersion} mono />
        <Field
          label={t('summary.scopes')}
          value={config.scopes.length > 0 ? config.scopes.join(', ') : t('summary.scopesEmpty')}
          muted={config.scopes.length === 0}
        />
        <Field label={t('summary.redirectUri')} value={config.redirectUri} mono fullWidth />
        <Field
          label={t('summary.oauthStateSecret')}
          value={config.hasOauthStateSecret
            ? t('summary.secretFingerprint', { last4: config.oauthStateSecretLast4 ?? '••••' })
            : t('summary.secretMissing')}
          mono
          muted={!config.hasOauthStateSecret}
        />
        {config.extraSecretKeys.length > 0 && (
          <Field
            label={t('summary.extraSecretKeys')}
            value={config.extraSecretKeys.join(', ')}
            mono
            fullWidth
          />
        )}
      </dl>

      {/* Redirect-URI banner */}
      {config.redirectUri !== suggested && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
          {t('summary.redirectMismatchHint', { url: suggested })}
        </div>
      )}

      {/* Connect error */}
      {connectError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {t('connect.error', { message: connectError })}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {t('summary.updatedAt', { date: new Date(config.updatedAt).toLocaleString() })}
        </p>
        <div className="flex flex-wrap gap-2">
          {meta.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('actions.openDevConsole')} ↗
            </a>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            {t('actions.edit')}
          </Button>
          {config.isEnabled && config.hasAppSecret && meta.redirectCallbackWired && (
            <Button
              variant="primary"
              size="sm"
              onClick={onConnect}
              loading={connecting}
            >
              {t('actions.connectAccount')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, mono, muted, fullWidth,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'md:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={`mt-0.5 break-all text-sm ${mono ? 'font-mono' : ''} ${
          muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
