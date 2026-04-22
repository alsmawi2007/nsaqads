import { cn } from '@/lib/utils/cn';

type Platform = 'META' | 'TIKTOK' | 'GOOGLE_ADS' | 'SNAPCHAT';

const platformConfig: Record<Platform, { label: string; className: string }> = {
  META:       { label: 'Meta',        className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' },
  TIKTOK:     { label: 'TikTok',      className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  GOOGLE_ADS: { label: 'Google Ads',  className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  SNAPCHAT:   { label: 'Snapchat',    className: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400' },
};

interface PlatformBadgeProps {
  platform: Platform;
  className?: string;
}

export function PlatformBadge({ platform, className }: PlatformBadgeProps) {
  const { label, className: colorClass } = platformConfig[platform] ?? {
    label: platform,
    className: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        colorClass,
        className,
      )}
    >
      {label}
    </span>
  );
}
