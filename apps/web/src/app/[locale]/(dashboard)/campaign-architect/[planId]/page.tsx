'use client';

import { useParams } from 'next/navigation';
import { PlanReviewPage } from '@/features/campaign-architect/pages/plan-review.page';

export default function Page() {
  const { planId } = useParams<{ planId: string }>();
  if (!planId) return null;
  return <PlanReviewPage planId={planId} />;
}
