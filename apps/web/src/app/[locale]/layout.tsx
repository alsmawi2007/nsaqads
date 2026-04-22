import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Geist } from 'next/font/google';
import { routing } from '@/lib/i18n/routing';
import { QueryProvider } from '@/components/providers/query-provider';
import { getBrand } from '@/config/brand';
import type { Metadata } from 'next';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

type Locale = 'en' | 'ar';

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const brand = getBrand(locale);
  return {
    title: { template: `%s | ${brand.name}`, default: brand.name },
    description: brand.tagline,
    applicationName: brand.name,
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  const messages = await getMessages();

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className={geist.variable}>
      <body className="bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
