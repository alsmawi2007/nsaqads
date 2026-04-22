import { cn } from '@/lib/utils/cn';

type Variant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'info';

const variants: Record<Variant, string> = {
  default: 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  danger:  'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  muted:   'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  info:    'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
