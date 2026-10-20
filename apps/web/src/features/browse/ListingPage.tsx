import { ArrowLeft, MapPin } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { SafetyActions } from '../safety/SafetyActions';
import { useListing, useListingOwner } from './useListings';
import { ProposalComposer } from './ProposalComposer';
import {
  ListingCondition,
  ListingPlaceholder,
  ListingRetry,
} from './ListingContent';
import {
  ListingImage,
  PhotoLoadError,
  useListingPhotos,
} from './listing-photos';

export function ListingPage() {
  const { id = '' } = useParams();
  const listing = useListing(id);
  const owner = useListingOwner(listing.data?.ownerId ?? '');
  const photos = useListingPhotos(id);
  const { session } = useAuth();

  if (listing.isPending) return <p role="status">Loading item…</p>;

  if (listing.isError)
    return (
      <section className="panel route-panel">
        <h1>Item unavailable</h1>
        {listing.error instanceof ApiError &&
        [400, 404].includes(listing.error.status ?? 0) ? (
          <p>This item cannot be found or has been withdrawn.</p>
        ) : (
          <ListingRetry retry={() => void listing.refetch()} />
        )}
        <Link to="/browse">Back to Browse</Link>
      </section>
    );

  const item = listing.data;

  return (
    <section className="listing-detail" aria-labelledby="listing-title">
      <Link to="/browse">
        <ArrowLeft size={18} aria-hidden="true" /> Back to Browse
      </Link>
      <div className="listing-detail-grid">
        <div>
          {photos.isPending ? (
            <div className="photo-unavailable" role="status">
              Loading photos…
            </div>
          ) : photos.isError ? (
            <div>
              <PhotoLoadError />
              <Button onClick={() => void photos.refetch()}>
                Retry photos
              </Button>
            </div>
          ) : photos.data.length ? (
            <div className="listing-detail-photos">
              {photos.data.map((photo, index) => (
                <ListingImage
                  key={photo.id}
                  photo={photo}
                  title={item.title}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <ListingPlaceholder />
          )}
        </div>
        <div className="panel listing-detail-card">
          <header className="listing-detail-summary">
            <h1 id="listing-title">{item.title}</h1>
            <div className="listing-detail-facts">
              <ListingCondition condition={item.condition} />
              <span
                className="listing-availability"
                data-available={item.availability === 'available'}
              >
                {item.availability === 'available'
                  ? 'Available'
                  : 'Currently unavailable for a trade'}
              </span>
            </div>
          </header>
          <section
            className="listing-detail-section"
            aria-labelledby="listing-description-heading"
          >
            <h2 id="listing-description-heading">About this item</h2>
            <p className="listing-description">{item.description}</p>
          </section>
          <div className="listing-detail-member-actions">
            <section
              className="listing-detail-section"
              aria-labelledby="listing-owner-heading"
            >
              <h2 id="listing-owner-heading">Shared by</h2>
              {owner.isPending ? (
                <p role="status">Loading owner…</p>
              ) : owner.isError ? (
                <div>
                  <p role="alert">Owner profile could not be loaded.</p>
                  <Button onClick={() => void owner.refetch()}>
                    Retry owner profile
                  </Button>
                </div>
              ) : (
                <div className="listing-detail-owner">
                  <Link to={`/members/${owner.data.id}`}>
                    {owner.data.displayName}
                  </Link>
                  <p className="listing-detail-location">
                    <MapPin size={16} aria-hidden="true" />
                    <span>
                      <span className="listing-detail-label">
                        Approximate location
                      </span>
                      {owner.data.approximateLocation || 'Not shared'}
                    </span>
                  </p>
                </div>
              )}
            </section>
            <section
              className="listing-detail-section listing-detail-connect"
              aria-labelledby="listing-connect-heading"
            >
              <h2 id="listing-connect-heading">
                {session?.user.id === item.ownerId
                  ? 'Manage your item'
                  : 'Interested in this item?'}
              </h2>
              {session?.user.id === item.ownerId && (
                <div className="message-action">
                  {item.availability === 'available' && (
                    <Button asChild>
                      <Link to={`/listings/${item.id}/edit`}>Edit item</Link>
                    </Button>
                  )}
                  <Link to="/shelf">My Shelf</Link>
                </div>
              )}
              {session && owner.data && (
                <ProposalComposer
                  key={item.id}
                  item={item}
                  ownerName={owner.data.displayName}
                />
              )}
              {!session && item.availability === 'available' && (
                <div className="message-action">
                  <Button asChild>
                    <Link
                      to={`/sign-in?next=${encodeURIComponent(`/listings/${item.id}`)}`}
                    >
                      Sign in to preview a trade
                    </Link>
                  </Button>
                </div>
              )}
            </section>
          </div>
          <div className="listing-detail-safety">
            <SafetyActions
              compact
              key={item.id}
              userId={item.ownerId}
              name={owner.data?.displayName ?? 'this member'}
              targetType="listing"
              targetId={item.id}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
