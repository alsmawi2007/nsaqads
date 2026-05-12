'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils/cn';
import type {
  RedactedProviderConfig,
  UpsertProviderConfigPayload,
} from '@/lib/api/provider-configs';
import { PLATFORM_META, suggestRedirectUri } from './platform-meta';

interface ProviderConfigFormProps {
  config:    RedactedProviderConfig | null;
  platform:  RedactedProviderConfig['platform'];
  onSave:    (payload: UpsertProviderConfigPayload) => void;
  onCancel:  () => void;
  isSaving:  boolean;
  saveError: string | null;
}

// Internal mutable shape — secrets are kept as strings so the form is the
// single source of truth for what the admin typed. Empty string means
// "no change" on update; required on create.
interface FormState {
  isEnabled:        boolean;
  appId:            string;
  appSecret:        string;
  redirectUri:      string;
  oauthStateSecret: string;
  apiVersion:       string;
  scopesCsv:        string;
  extra:            Record<string, string>;
  extraSecrets:     Record<string, string>;
}

function buildInitialForm(
  config:   RedactedProviderConfig | null,
  platform: RedactedProviderConfig['platform'],
): FormState {
  const meta = PLATFORM_META[platform];
  if (config) {
    return {
      isEnabled:        config.isEnabled,
      appId:            config.appId,
      appSecret:        '',  // never returned
      redirectUri:      config.redirectUri,
      oauthStateSecret: '',  // never returned
      apiVersion:       config.apiVersion ?? meta.apiVersion,
      scopesCsv:        config.scopes.join(', '),
      extra:            stringifyExtraValues(config.extra ?? {}, meta.extraKeys.map((k) => k.key)),
      extraSecrets:     Object.fromEntries(meta.extraSecretKeys.map((k) => [k.key, ''])),
    };
  }
  // First-time create
  return {
    isEnabled:        true,
    appId:            '',
    appSecret:        '',
    redirectUri:      suggestRedirectUri(platform),
    oauthStateSecret: '',
    apiVersion:       meta.apiVersion,
    scopesCsv:        meta.defaultScopes.join(', '),
    extra:            Object.fromEntries(meta.extraKeys.map((k) => [k.key, ''])),
    extraSecrets:     Object.fromEntries(meta.extraSecretKeys.map((k) => [k.key, ''])),
  };
}

function stringifyExtraValues(extra: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = extra[k];
    out[k] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

export function ProviderConfigForm({
  config,
  platform,
  onSave,
  onCancel,
  isSaving,
  saveError,
}: ProviderConfigFormProps) {
  const t = useTranslations('providerConfigs');
  const meta = PLATFORM_META[platform];
  const isCreate = !config;
  const [form, setForm] = useState<FormState>(() => buildInitialForm(config, platform));

  const errors = useMemo(() => validateForm(form, isCreate), [form, isCreate]);

  function submit() {
    if (Object.keys(errors).length > 0) return;
    const payload: UpsertProviderConfigPayload = {
      isEnabled:   form.isEnabled,
      appId:       form.appId.trim(),
      redirectUri: form.redirectUri.trim(),
      apiVersion:  form.apiVersion.trim() || undefined,
      scopes:      parseCsv(form.scopesCsv),
    };
    if (form.appSecret) payload.appSecret = form.appSecret;
    if (form.oauthStateSecret) payload.oauthStateSecret = form.oauthStateSecret;

    const extraDefined = Object.fromEntries(
      Object.entries(form.extra).filter(([, v]) => v.trim().length > 0),
    );
    if (Object.keys(extraDefined).length > 0) payload.extra = extraDefined;

    const extraSecretsDefined = Object.fromEntries(
      Object.entries(form.extraSecrets).filter(([, v]) => v.trim().length > 0),
    );
    if (Object.keys(extraSecretsDefined).length > 0) payload.extraSecrets = extraSecretsDefined;

    onSave(payload);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Enabled toggle */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <Toggle
          checked={form.isEnabled}
          onChange={(v) => setForm((f) => ({ ...f, isEnabled: v }))}
          label={t('form.isEnabled.label')}
          description={t('form.isEnabled.description')}
        />
      </div>

      {/* Core OAuth fields */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          id="appId"
          label={t('form.appId.label')}
          value={form.appId}
          onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
          placeholder={t('form.appId.placeholder')}
          error={errors.appId}
        />
        <Input
          id="apiVersion"
          label={t('form.apiVersion.label')}
          value={form.apiVersion}
          onChange={(e) => setForm((f) => ({ ...f, apiVersion: e.target.value }))}
          placeholder={meta.apiVersion}
        />
      </div>

      <Input
        id="redirectUri"
        label={t('form.redirectUri.label')}
        value={form.redirectUri}
        onChange={(e) => setForm((f) => ({ ...f, redirectUri: e.target.value }))}
        error={errors.redirectUri}
      />
      <p className="-mt-3 text-xs text-slate-500 dark:text-slate-400">
        {t('form.redirectUri.hint', { url: suggestRedirectUri(platform) })}
      </p>

      <SecretField
        id="appSecret"
        label={t('form.appSecret.label')}
        existingLast4={config?.appSecretLast4 ?? null}
        hasExisting={!!config?.hasAppSecret}
        value={form.appSecret}
        onChange={(v) => setForm((f) => ({ ...f, appSecret: v }))}
        required={isCreate}
        error={errors.appSecret}
      />

      <SecretField
        id="oauthStateSecret"
        label={t('form.oauthStateSecret.label')}
        existingLast4={config?.oauthStateSecretLast4 ?? null}
        hasExisting={!!config?.hasOauthStateSecret}
        value={form.oauthStateSecret}
        onChange={(v) => setForm((f) => ({ ...f, oauthStateSecret: v }))}
        required={isCreate}
        error={errors.oauthStateSecret}
        hint={t('form.oauthStateSecret.hint')}
      />

      <Input
        id="scopes"
        label={t('form.scopes.label')}
        value={form.scopesCsv}
        onChange={(e) => setForm((f) => ({ ...f, scopesCsv: e.target.value }))}
        placeholder={meta.defaultScopes.join(', ')}
      />
      {meta.notes && (
        <p className="-mt-3 text-xs text-amber-600 dark:text-amber-400">{meta.notes}</p>
      )}

      {/* Advanced (extra + extraSecrets) — only renders for platforms that need it */}
      {(meta.extraKeys.length > 0 || meta.extraSecretKeys.length > 0) && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('form.advanced.title')}
          </h3>
          {meta.extraKeys.map((k) => (
            <Input
              key={k.key}
              id={`extra-${k.key}`}
              label={k.label}
              value={form.extra[k.key] ?? ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  extra: { ...f.extra, [k.key]: e.target.value },
                }))
              }
              placeholder={k.hint}
            />
          ))}
          {meta.extraSecretKeys.map((k) => (
            <SecretField
              key={k.key}
              id={`extraSecret-${k.key}`}
              label={k.label}
              existingLast4={null}
              hasExisting={!!config?.extraSecretKeys.includes(k.key)}
              value={form.extraSecrets[k.key] ?? ''}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  extraSecrets: { ...f.extraSecrets, [k.key]: v },
                }))
              }
              required={false}
              hint={k.hint}
            />
          ))}
        </div>
      )}

      {/* Save bar */}
      {saveError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {saveError}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          {t('actions.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          loading={isSaving}
          disabled={Object.keys(errors).length > 0}
        >
          {isCreate ? t('actions.create') : t('actions.save')}
        </Button>
      </div>
    </div>
  );
}

// ─── Secret field with masked existing state ───────────────────────────────

interface SecretFieldProps {
  id:             string;
  label:          string;
  existingLast4:  string | null;
  hasExisting:    boolean;
  value:          string;
  onChange:       (v: string) => void;
  required:       boolean;
  error?:         string;
  hint?:          string;
}

function SecretField({
  id, label, existingLast4, hasExisting, value, onChange, required, error, hint,
}: SecretFieldProps) {
  const t = useTranslations('providerConfigs');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
        <span>
          {label}
          {required && <span className="ms-1 text-red-500">*</span>}
        </span>
        {hasExisting && (
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            {existingLast4
              ? t('form.secret.existing', { last4: existingLast4 })
              : t('form.secret.existingNoFingerprint')}
          </span>
        )}
      </label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasExisting ? t('form.secret.placeholderKeep') : t('form.secret.placeholderEnter')}
        className={cn(
          'h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
          'dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500',
          error
            ? 'border-red-400 focus:ring-red-400'
            : 'border-slate-300 dark:border-slate-600',
        )}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Validation ────────────────────────────────────────────────────────────

function validateForm(form: FormState, isCreate: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.appId.trim()) e.appId = 'required';
  if (!form.redirectUri.trim()) e.redirectUri = 'required';
  else if (!/^https:\/\//.test(form.redirectUri.trim())) e.redirectUri = 'mustBeHttps';
  if (isCreate) {
    if (form.appSecret.length < 8) e.appSecret = 'min8';
    if (form.oauthStateSecret.length < 16) e.oauthStateSecret = 'min16';
  } else {
    if (form.appSecret && form.appSecret.length < 8) e.appSecret = 'min8';
    if (form.oauthStateSecret && form.oauthStateSecret.length < 16) e.oauthStateSecret = 'min16';
  }
  return e;
}

function parseCsv(csv: string): string[] {
  return csv
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
