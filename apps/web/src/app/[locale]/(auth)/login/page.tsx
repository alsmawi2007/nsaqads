'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api/auth';
import { setTokens } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/auth.store';
import { getBrand } from '@/config/brand';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const { setUser, setActiveOrg } = useAuthStore();
  const brand = getBrand(locale);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await authApi.login(email, password);
      setTokens(data.accessToken, data.refreshToken);
      setUser({
        sub: data.user.id,
        email: data.user.email,
        isSystemAdmin: data.user.isSystemAdmin,
      });
      if (data.orgs?.[0]) {
        const first = data.orgs[0];
        setActiveOrg({
          id:   first.id,
          name: first.name,
          slug: first.slug,
          role: first.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
        });
      }
      router.push(`/${locale}`);
    } catch {
      setError(t('invalidCredentials'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="mb-8 text-center">
        <span className="text-3xl font-bold text-brand-600">{brand.name}</span>
        <h1 className="mt-3 text-xl font-semibold text-slate-800 dark:text-slate-200">{t('loginTitle')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('loginSubtitle')}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="email"
            type="email"
            label={t('email')}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            id="password"
            type="password"
            label={t('password')}
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          <Button type="submit" loading={loading} className="mt-1 w-full">
            {loading ? t('signingIn') : t('signIn')}
          </Button>
        </form>
      </div>
    </div>
  );
}
