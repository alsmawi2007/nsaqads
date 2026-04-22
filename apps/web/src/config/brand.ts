export const BRAND = {
  ar: {
    name: 'نسق',
    platform: 'منصة نسق',
    system: 'نظام نسق',
    tagline: 'نظام ذكي لتحسين الحملات',
  },
  en: {
    name: 'Nsaq',
    platform: 'Nsaq Platform',
    system: 'Nsaq System',
    tagline: 'Smart system for optimizing campaigns',
  },
} as const;

export type BrandLocale = keyof typeof BRAND;

export function getBrand(locale: string): (typeof BRAND)[BrandLocale] {
  return locale === 'ar' ? BRAND.ar : BRAND.en;
}
