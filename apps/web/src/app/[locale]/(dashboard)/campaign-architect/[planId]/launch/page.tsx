'use client';

import { useParams } from 'next/navigation';
import { LaunchPage } from '@/features/campaign-architect/pages/launch.page';

export default function Page() {
  const { planId } = useParams<{ planId: string }>();
  if (!planId) return null;
  return <LaunchPage planId={planId} />;
}
