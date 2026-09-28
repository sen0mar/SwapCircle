import { lazy, Suspense } from 'react';
import { HomeContent } from './HomeContent';
import { useListings } from '../browse/useListings';
import { CatalogGrid } from '../browse/CatalogGrid';
import { ListingRetry } from '../browse/ListingContent';
import { MemberDiscovery } from './MemberDiscovery';

const DevelopmentHome = import.meta.env.DEV
  ? lazy(() => import('./DevelopmentHome'))
  : null;

function HomeListings() {
  const listings = useListings({ availability: 'available', limit: 4 });

  if (listings.isPending) return <p role="status">Loading items…</p>;

  if (listings.isError)
    return <ListingRetry retry={() => void listings.refetch()} />;

  return listings.data.items.length ? (
    <CatalogGrid items={listings.data.items} />
  ) : (
    <p>No available items shared yet.</p>
  );
}

function LiveHome() {
  return (
    <HomeContent
      live
      listingContent={<HomeListings />}
      memberContent={<MemberDiscovery />}
    />
  );
}

export function Home() {
  return DevelopmentHome ? (
    <Suspense fallback={<LiveHome />}>
      <DevelopmentHome>
        <LiveHome />
      </DevelopmentHome>
    </Suspense>
  ) : (
    <LiveHome />
  );
}
