import { Link } from 'react-router-dom';
import { useListingOwner } from './useListings';
import { ImageOff, MapPin } from 'lucide-react';
import type { Listing } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';

export const conditions: Record<Listing['condition'], string> = {
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export function ListingCondition({
  condition,
}: {
  condition: Listing['condition'];
}) {
  return (
    <span className="listing-condition">
      <span
        className="listing-condition-dot"
        data-condition={condition}
        aria-hidden="true"
      />
      {conditions[condition]}
    </span>
  );
}

export function ListingPlaceholder() {
  return (
    <div className="photo-unavailable">
      <ImageOff aria-hidden="true" />
      <span>No photo yet</span>
    </div>
  );
}

export function ListingRetry({ retry }: { retry: () => void }) {
  return (
    <div className="panel route-panel">
      <p role="alert">
        Items could not be loaded. Check your connection and try again. The
        service may be waking up.
      </p>
      <Button onClick={retry}>Retry</Button>
    </div>
  );
}

export function CatalogOwner({ id }: { id: string }) {
  const owner = useListingOwner(id);

  if (owner.isPending) return <p>Loading owner…</p>;

  if (owner.isError) return <p>Owner details available on the item page.</p>;

  const [city, ...districtParts] = (
    owner.data.approximateLocation || 'Location not shared'
  ).split(/\s*·\s*/);
  const district = districtParts.join(' · ');

  return (
    <>
      <p className="listing-owner">
        <Link to={`/members/${id}`}>{owner.data.displayName}</Link>
      </p>
      <p className="listing-location">
        <MapPin size={14} aria-hidden="true" />
        <span className="listing-location-label">
          <span>{city}</span>
          {district && (
            <span className="listing-location-district">{district}</span>
          )}
        </span>
      </p>
    </>
  );
}
