'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/lib/stores/auth.store';
import { useUIStore } from '@/lib/stores/ui.store';
import { clearTokens } from '@/lib/api/client';
import { getBrand } from '@/config/brand';

const LayoutGridIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);
const CampaignsIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);
const OptimizerIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);
const ArchitectIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09zM18 11.25l-.345-1.205a2.25 2.25 0 0 0-1.546-1.546L14.904 8.25l1.205-.345a2.25 2.25 0 0 0 1.546-1.546L18 5.155l.345 1.205a2.25 2.25 0 0 0 1.546 1.546l1.205.345-1.205.345a2.25 2.25 0 0 0-1.546 1.546L18 11.25z" />
  </svg>
);
const AlertsIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);
const SettingsIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const PluginIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M14 6V4a1 1 0 00-1-1h-2a1 1 0 00-1 1v2H7a2 2 0 00-2 2v4a4 4 0 004 4v3a1 1 0 001 1h4a1 1 0 001-1v-3a4 4 0 004-4V8a2 2 0 00-2-2h-3z" />
  </svg>
);
const MembersIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6 5.87a4 4 0 00-8 0M16 7a4 4 0 11-8 0 4 4 0 018 0zm6 3a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const LinkIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M13.828 10.172a4 4 0 015.656 5.656l-3 3a4 4 0 01-5.656-5.656m-1.656-4l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
  </svg>
);
const FlaskIcon = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M14.121 4v6.394l4.243 7.07A2 2 0 0116.706 21H7.294a2 2 0 01-1.658-3.536l4.243-7.07V4M9 4h6" />
  </svg>
);
const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg className={cn('h-4 w-4 transition-transform', collapsed ? 'rotate-180' : '')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);
const SignOutIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

export function Sidebar() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { user, activeOrg, logout: zustandLogout } = useAuthStore();
  const { sidebarCollapsed, setSidebarCollapsed } = useUIStore();
  const brand = getBrand(locale);

  const navItems: Array<{ href: string; label: string; icon: React.ReactNode }> = [
    { href: '/', label: t('dashboard'), icon: <LayoutGridIcon /> },
    { href: '/campaigns', label: t('campaigns'), icon: <CampaignsIcon /> },
    { href: '/campaign-architect', label: t('campaignArchitect'), icon: <ArchitectIcon /> },
    { href: '/ad-accounts', label: t('adAccounts'), icon: <LinkIcon /> },
    { href: '/optimizer', label: t('optimizer'), icon: <OptimizerIcon /> },
    { href: '/alerts', label: t('alerts'), icon: <AlertsIcon /> },
    { href: '/settings', label: t('settings'), icon: <SettingsIcon /> },
  ];
  // Members link is visible to every org member; permissions on the page
  // itself decide what each role can actually do.
  if (activeOrg) {
    navItems.push({ href: '/settings/members', label: t('members'), icon: <MembersIcon /> });
    // Activation Lab is a per-org diagnostic surface: any member can read,
    // but only ADMIN+ sees the action buttons inside the page.
    navItems.push({ href: '/settings/activation-lab', label: t('activationLab'), icon: <FlaskIcon /> });
  }
  if (user?.isSystemAdmin) {
    navItems.push({ href: '/settings/providers', label: t('providerConfigs'), icon: <PluginIcon /> });
  }

  function handleSignOut() {
    clearTokens();
    zustandLogout();
    router.push(`/${locale}/login`);
  }

  function isActive(href: string) {
    const localePath = `/${locale}${href === '/' ? '' : href}`;
    if (href === '/') return pathname === `/${locale}` || pathname === `/${locale}/`;
    return pathname.startsWith(localePath);
  }

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-e border-slate-200 bg-white transition-all duration-200 dark:border-slate-700 dark:bg-slate-900',
        sidebarCollapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-700">
        {!sidebarCollapsed && (
          <span className="text-lg font-bold text-brand-600">{brand.name}</span>
        )}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={t('toggleSidebar')}
          title={t('toggleSidebar')}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <ChevronIcon collapsed={!sidebarCollapsed} />
        </button>
      </div>

      {/* Org name */}
      {!sidebarCollapsed && activeOrg && (
        <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{activeOrg.name}</p>
        </div>
      )}

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href as '/'}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive(item.href)
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-200 p-2 dark:border-slate-700">
        {/* Locale switcher */}
        {!sidebarCollapsed && (
          <div className="mb-2 flex gap-1 px-1">
            {(['en', 'ar'] as const).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => router.push(pathname.replace(`/${locale}`, `/${loc}`))}
                className={cn(
                  'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  loc === locale
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                )}
              >
                {loc === 'en' ? 'EN' : 'ع'}
              </button>
            ))}
          </div>
        )}
        {/* User + sign out */}
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{user?.email}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title={t('signOut')}
          >
            <SignOutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
