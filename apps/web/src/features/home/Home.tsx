import { lazy, Suspense } from 'react';
import { HomeContent } from './HomeContent';

const DevelopmentHome = import.meta.env.DEV
  ? lazy(() => import('./DevelopmentHome'))
  : null;

export function Home() {
  return DevelopmentHome ? (
    <Suspense fallback={<HomeContent />}>
      <DevelopmentHome />
    </Suspense>
  ) : (
    <HomeContent />
  );
}
