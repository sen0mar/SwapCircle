import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '../../components/ui/card';
import { useListings } from './useListings';
import { CatalogOwner, conditions, ListingRetry } from './ListingContent';
import {
  ListingImage,
  PhotoLoadError,
  useListingPhotos,
} from './listing-photos';

function CatalogPhoto({ id, title }: { id: string; title: string }) {
  const photos = useListingPhotos(id);
  if (photos.isPending)
    return (
      <div className="photo-unavailable" role="status">
        Loading photo…
      </div>
    );
  if (photos.isError) return <PhotoLoadError />;
  return <ListingImage photo={photos.data[0]} title={title} />;
}

export function BrowsePage() {
  const [params] = useSearchParams();
  const cursor = params.get('cursor') ?? '';
  const listings = useListings(cursor);

  return (
    <section className="catalog-page" aria-labelledby="browse-title">
      <div className="section-heading">
        <div>
          <h1 id="browse-title">Browse</h1>
          <p>Find something with a little more life to give.</p>
        </div>
      </div>
      {listings.isPending ? (
        <p role="status">Loading items…</p>
      ) : listings.isError ? (
        <>
          <ListingRetry retry={() => void listings.refetch()} />
          {cursor && <Link to="/browse">Start from the first page</Link>}
        </>
      ) : (
        <>
          {listings.data.items.length ? (
            <div className="listing-grid">
              {listings.data.items.map((item) => (
                <Card className="listing-card" key={item.id}>
                  <article>
                    <CatalogPhoto id={item.id} title={item.title} />
                    <div className="listing-copy">
                      <h2>
                        <Link to={`/listings/${item.id}`}>{item.title}</Link>
                      </h2>
                      <p>{conditions[item.condition]}</p>
                      <CatalogOwner id={item.ownerId} />
                    </div>
                  </article>
                </Card>
              ))}
            </div>
          ) : (
            <div className="panel route-panel">
              <h2>No items to show yet</h2>
              <p>Available items will appear here when members share them.</p>
            </div>
          )}
          <nav className="catalog-pagination" aria-label="Catalog pages">
            {cursor && <Link to="/browse">First page</Link>}
            {listings.data.nextCursor && (
              <Link
                to={`/browse?${new URLSearchParams({ cursor: listings.data.nextCursor })}`}
              >
                Next page
              </Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
