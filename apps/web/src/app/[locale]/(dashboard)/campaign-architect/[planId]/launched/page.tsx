'use client';

import { useParams } from 'next/navigation';
import { LaunchedPage } from '@/features/campaign-architect/pages/launched.page';

export default function Page() {
  const { planId } = useParams<{ planId: string }>();
  if (!planId) return null;
  return <LaunchedPage planId={planId} />;
}
