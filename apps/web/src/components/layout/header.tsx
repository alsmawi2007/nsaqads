'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: HeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TopBar() {
  const t = useTranslations('common');
  return (
    <header className="flex h-14 items-center border-b border-slate-200 bg-white px-6 dark:border-slate-700 dark:bg-slate-900">
      <p className="ms-auto text-xs text-slate-400">{t('status')}</p>
    </header>
  );
}
