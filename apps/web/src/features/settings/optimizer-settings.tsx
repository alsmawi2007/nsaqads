'use client';

/**
 * OptimizerSettings — full settings form for the optimizer.
 *
 * Sections (top → bottom):
 *   1. Master Control  — enable toggle + mode card selector
 *   2. Budget Guardrails — max increase %, max decrease %
 *   3. Bid Guardrails   — max bid change %
 *   4. Performance Thresholds — target ROAS, CPA, min impressions
 *   5. Timing           — cooldown hours, cycle interval
 *   6. Save bar         — unsaved indicator + save button
 *
 * Safety design:
 *   - Disabled optimizer shows a banner; controls are dimmed but still visible
 *   - AUTO_APPLY mode card carries an amber warning strip
 *   - Every numeric input shows its unit inline
 *   - No auto-save — explicit save button prevents accidental changes
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils/cn';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import type { OptimizerSettings } from '@/lib/api/settings';

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

function SectionCard({ children, dimmed }: { children: React.ReactNode; dimmed?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800',
        'transition-opacity',
        dimmed && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </div>
  );
}

// ─── Numeric field with inline unit ───────────────────────────────────────────

interface NumericFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  nullable?: boolean;
}

function NumericField({
  id, label, hint, value, onChange, min, max, step = 1, unit, placeholder, nullable,
}: NumericFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (nullable && raw === '') { onChange(null); return; }
            const n = parseFloat(raw);
            if (!isNaN(n)) onChange(n);
          }}
          className={cn(
            'h-9 w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
            'dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-100',
            unit ? 'pe-10 ps-3' : 'px-3',
          )}
        />
        {unit && (
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{hint}</p>
      )}
    </div>
  );
}

// ─── Mode card selector ───────────────────────────────────────────────────────

type OptimizerMode = 'OFF' | 'SUGGEST_ONLY' | 'AUTO_APPLY';

interface ModeCardProps {
  value: OptimizerMode;
  selected: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  icon: React.ReactNode;
  warning?: string;
  colorClass: {
    border: string;
    bg: string;
    iconBg: string;
    iconColor: string;
    radio: string;
  };
}

function ModeCard({
  value, selected, onSelect, label, description, icon, warning, colorClass,
}: ModeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-xl border-2 text-start transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        selected
          ? cn('bg-white dark:bg-slate-800', colorClass.border)
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50',
      )}
      aria-pressed={selected}
    >
      {/* Card body */}
      <div className="flex flex-col gap-2.5 p-4">
        {/* Icon + radio row */}
        <div className="flex items-center justify-between">
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', colorClass.iconBg)}>
            <div className={colorClass.iconColor}>{icon}</div>
          </div>
          {/* Radio indicator */}
          <div
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
              selected
                ? cn(colorClass.radio, 'border-transparent')
                : 'border-slate-300 dark:border-slate-600',
            )}
          >
            {selected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
          <span className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</span>
        </div>
      </div>

      {/* Warning strip — only for AUTO_APPLY */}
      {warning && (
        <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800/40 dark:bg-amber-900/10">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{warning}</span>
        </div>
      )}
    </button>
  );
}

// ─── Disabled banner ──────────────────────────────────────────────────────────

function DisabledBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
      <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="text-xs text-slate-500 dark:text-slate-400">{message}</span>
    </div>
  );
}

// ─── Section divider ──────────────────────────────────────────────────────────

function Divider() {
  return <div className="h-px bg-slate-200 dark:bg-slate-700" />;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface OptimizerSettingsFormProps {
  initialSettings: OptimizerSettings;
  isSaving: boolean;
  savedOk: boolean;
  saveError: boolean;
  onSave: (settings: OptimizerSettings) => void;
  form: OptimizerSettings;
  setForm: React.Dispatch<React.SetStateAction<OptimizerSettings>>;
}

export function OptimizerSettingsForm({
  initialSettings,
  isSaving,
  savedOk,
  saveError,
  onSave,
  form,
  setForm,
}: OptimizerSettingsFormProps) {
  const t = useTranslations('settings');

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialSettings),
    [form, initialSettings],
  );

  function set<K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // ── Mode card definitions ──────────────────────────────────────────────────

  const modeCards: {
    value: OptimizerMode;
    label: string;
    description: string;
    icon: React.ReactNode;
    warning?: string;
    colorClass: ModeCardProps['colorClass'];
  }[] = [
    {
      value: 'OFF',
      label: t('modeOff'),
      description: t('modeOffDesc'),
      colorClass: {
        border: 'border-slate-400 dark:border-slate-500',
        bg: 'bg-white dark:bg-slate-800',
        iconBg: 'bg-slate-100 dark:bg-slate-700',
        iconColor: 'text-slate-500 dark:text-slate-400',
        radio: 'bg-slate-500',
      },
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
    {
      value: 'SUGGEST_ONLY',
      label: t('modeSuggestOnly'),
      description: t('modeSuggestOnlyDesc'),
      colorClass: {
        border: 'border-amber-400 dark:border-amber-500',
        bg: 'bg-amber-50/50 dark:bg-amber-900/10',
        iconBg: 'bg-amber-100 dark:bg-amber-900/30',
        iconColor: 'text-amber-600 dark:text-amber-400',
        radio: 'bg-amber-500',
      },
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
    },
    {
      value: 'AUTO_APPLY',
      label: t('modeAutoApply'),
      description: t('modeAutoApplyDesc'),
      warning: t('modeAutoApplyWarning'),
      colorClass: {
        border: 'border-brand-500 dark:border-brand-400',
        bg: 'bg-brand-50/50 dark:bg-brand-900/10',
        iconBg: 'bg-brand-100 dark:bg-brand-900/30',
        iconColor: 'text-brand-600 dark:text-brand-400',
        radio: 'bg-brand-500',
      },
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
  ];

  const isDisabled = !form.enabled;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Section 1: Master Control ──────────────────────────────────────── */}
      <SectionCard>
        <SectionHeader title={t('masterControl')} description={t('masterControlDesc')} />

        {/* Enable toggle */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 dark:border-slate-700 dark:bg-slate-900/30">
          <Toggle
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            label={t('optimizerEnabled')}
            description={t('optimizerEnabledDesc')}
          />
        </div>

        {/* Disabled notice */}
        {isDisabled && (
          <div className="mt-3">
            <DisabledBanner message={t('disabledBanner')} />
          </div>
        )}

        {/* Mode selector */}
        <div className={cn('mt-5', isDisabled && 'pointer-events-none opacity-40')}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {t('modeLabel')}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {modeCards.map((card) => (
              <ModeCard
                key={card.value}
                {...card}
                selected={form.defaultMode === card.value}
                onSelect={() => set('defaultMode', card.value)}
              />
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── Section 2: Budget Guardrails ───────────────────────────────────── */}
      <SectionCard dimmed={isDisabled}>
        <SectionHeader title={t('budgetGuardrails')} description={t('budgetGuardrailsDesc')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumericField
            id="maxBudgetIncrease"
            label={t('maxBudgetIncrease')}
            hint={t('maxBudgetIncreaseDesc')}
            value={form.maxBudgetIncreasePct}
            onChange={(v) => set('maxBudgetIncreasePct', v ?? 30)}
            min={1}
            max={100}
            unit={t('unitPercent')}
          />
          <NumericField
            id="maxBudgetDecrease"
            label={t('maxBudgetDecrease')}
            hint={t('maxBudgetDecreaseDesc')}
            value={form.maxBudgetDecreasePct}
            onChange={(v) => set('maxBudgetDecreasePct', v ?? 20)}
            min={1}
            max={100}
            unit={t('unitPercent')}
          />
        </div>
      </SectionCard>

      {/* ── Section 3: Bid Guardrails ──────────────────────────────────────── */}
      <SectionCard dimmed={isDisabled}>
        <SectionHeader title={t('bidGuardrails')} description={t('bidGuardrailsDesc')} />
        <div className="max-w-xs">
          <NumericField
            id="maxBidChange"
            label={t('maxBidChange')}
            hint={t('maxBidChangeDesc')}
            value={form.maxBidChangePct}
            onChange={(v) => set('maxBidChangePct', v ?? 20)}
            min={1}
            max={100}
            unit={t('unitPercent')}
          />
        </div>
      </SectionCard>

      {/* ── Section 4: Performance Thresholds ─────────────────────────────── */}
      <SectionCard dimmed={isDisabled}>
        <SectionHeader title={t('performanceThresholds')} description={t('performanceThresholdsDesc')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumericField
            id="targetRoas"
            label={t('targetRoas')}
            hint={t('targetRoasDesc')}
            value={form.targetRoas}
            onChange={(v) => set('targetRoas', v)}
            min={0}
            step={0.1}
            unit={t('unitX')}
            placeholder="3.0"
            nullable
          />
          <NumericField
            id="targetCpa"
            label={t('targetCpa')}
            hint={t('targetCpaDesc')}
            value={form.targetCpa}
            onChange={(v) => set('targetCpa', v)}
            min={0}
            step={0.01}
            unit={t('unitSar')}
            placeholder="—"
            nullable
          />
          <NumericField
            id="minImpressions"
            label={t('minImpressions')}
            hint={t('minImpressionsDesc')}
            value={form.minSampleImpressions}
            onChange={(v) => set('minSampleImpressions', v ?? 1000)}
            min={0}
            step={100}
          />
        </div>
      </SectionCard>

      {/* ── Section 5: Timing ─────────────────────────────────────────────── */}
      <SectionCard dimmed={isDisabled}>
        <SectionHeader title={t('timingControls')} description={t('timingControlsDesc')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumericField
            id="cooldownHours"
            label={t('cooldownHours')}
            hint={t('cooldownHoursDesc')}
            value={form.cooldownHours}
            onChange={(v) => set('cooldownHours', v ?? 24)}
            min={1}
            max={168}
            unit={t('unitHours')}
          />
          <NumericField
            id="cycleInterval"
            label={t('cycleInterval')}
            hint={t('cycleIntervalDesc')}
            value={form.cycleIntervalMinutes}
            onChange={(v) => set('cycleIntervalMinutes', v ?? 60)}
            min={15}
            max={1440}
            step={15}
            unit={t('unitMinutes')}
          />
        </div>
      </SectionCard>

      {/* ── Save bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
        <Button
          size="sm"
          variant="primary"
          loading={isSaving}
          disabled={!isDirty && !isSaving}
          onClick={() => onSave(form)}
        >
          {t('saveSettings')}
        </Button>

        {isDirty && !isSaving && !savedOk && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            {t('unsavedChanges')}
          </span>
        )}
        {savedOk && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {t('saved')}
          </span>
        )}
        {saveError && (
          <span className="text-xs text-red-500">{t('saveError')}</span>
        )}
      </div>

    </div>
  );
}
