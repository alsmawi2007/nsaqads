'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { useAuthStore } from '@/lib/stores/auth.store';
import { authApi } from '@/lib/api/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, setUser } = useAuthStore();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();

  useEffect(() => {
    if (!user) {
      router.replace(`/${locale}/login`);
      return;
    }
    // Refresh from /auth/me so flags like isSystemAdmin pick up any
    // server-side changes (e.g. a DB UPDATE that promoted this user to
    // system admin) without forcing a logout. Silent on failure —
    // apiFetch already redirects to login on 401.
    authApi.me()
      .then((me) => {
        if (me.isSystemAdmin !== user.isSystemAdmin) {
          setUser({ ...user, isSystemAdmin: me.isSystemAdmin });
        }
      })
      .catch(() => { /* keep cached user untouched */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sub]);

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
