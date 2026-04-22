'use client';

import { useTranslations } from 'next-intl';
import { PageContainer } from '@/components/layout/page-container';

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('common');

  return (
    <PageContainer className="items-center justify-center">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-red-200 bg-red-50 px-8 py-10 text-center dark:border-red-800/40 dark:bg-red-900/10">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t('errorTitle')}</p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-500">{t('errorDesc')}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
          >
            {t('retry')}
          </button>
        )}
      </div>
    </PageContainer>
  );
}
