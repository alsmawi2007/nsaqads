import { cn } from '@/lib/utils/cn';
import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <main className={cn('flex flex-1 flex-col gap-6 overflow-y-auto p-6', className)}>
      {children}
    </main>
  );
}
