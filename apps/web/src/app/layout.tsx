import type { Metadata } from 'next';
import { BRAND } from '@/config/brand';
import './globals.css';

export const metadata: Metadata = {
  title: BRAND.en.name,
  description: BRAND.en.tagline,
  applicationName: BRAND.en.name,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
