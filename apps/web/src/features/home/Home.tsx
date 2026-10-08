import { HomeContent } from './HomeContent';
import { useListings } from '../browse/useListings';
import { CatalogGrid } from '../browse/CatalogGrid';
import { ListingRetry } from '../browse/ListingContent';
import { MemberDiscovery } from './MemberDiscovery';

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

export function Home() {
  return (
    <HomeContent
      listingContent={<HomeListings />}
      memberContent={<MemberDiscovery />}
    />
  );
}
