import { Link } from 'react-router-dom';
import type { Listing } from '@swapcircle/contracts';
import { Card } from '../../components/ui/card';
import { CatalogOwner, conditions } from './ListingContent';
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

export function CatalogGrid({ items }: { items: Listing[] }) {
  return (
    <div className="listing-grid">
      {items.map((item) => (
        <Card className="listing-card" key={item.id}>
          <article>
            <CatalogPhoto id={item.id} title={item.title} />
            <div className="listing-copy">
              <h2>
                <Link to={`/listings/${item.id}`}>{item.title}</Link>
              </h2>
              <p>
                {conditions[item.condition]} · {item.availability}
              </p>
              <CatalogOwner id={item.ownerId} />
            </div>
          </article>
        </Card>
      ))}
    </div>
  );
}
