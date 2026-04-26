'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  tone?: 'neutral' | 'danger';
}

export function ConfirmModal({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
  tone = 'neutral',
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, loading]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
        aria-hidden
      />
      <div
        className={cn(
          'relative w-full max-w-md rounded-xl border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800',
        )}
      >
        <div className="px-6 py-5">
          <h2
            id="confirm-modal-title"
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {description}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/30">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
