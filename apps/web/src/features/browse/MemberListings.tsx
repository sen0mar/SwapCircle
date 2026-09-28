import { Link } from 'react-router-dom';
import { CatalogGrid } from './CatalogGrid';
import { useListings } from './useListings';
import { ListingRetry } from './ListingContent';

export function MemberListings({ owner }: { owner: string }) {
  const listings = useListings({ owner, availability: 'available', limit: 4 });

  if (listings.isPending) return <p role="status">Loading items…</p>;

  if (listings.isError)
    return <ListingRetry retry={() => void listings.refetch()} />;

  return (
    <>
      {listings.data.items.length ? (
        <CatalogGrid items={listings.data.items} />
      ) : (
        <p>No available items shared yet.</p>
      )}
      <Link to={`/browse?owner=${encodeURIComponent(owner)}`}>
        Browse this member’s items
      </Link>
    </>
  );
}
