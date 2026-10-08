import { Select } from '../../components/ui/select';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { catalogQuerySchema } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useListings } from './useListings';
import { conditions, ListingRetry } from './ListingContent';
import { CatalogGrid } from './CatalogGrid';

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const search = params.toString();

  useEffect(() => {
    // Native history can restore edited form values from its back/forward cache.
    // Reset drafts to the URL-backed defaults on navigation and document restore.
    const reset = () => form.current?.reset();
    reset();
    // History restores persisted field values after its navigation events.
    const restore = () => window.setTimeout(reset, 0);
    window.addEventListener('pageshow', restore);
    window.addEventListener('popstate', restore);

    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('popstate', restore);
    };
  }, [search]);
  const parsed = catalogQuerySchema.safeParse({
    limit: 12,
    ...Object.fromEntries(params),
  });
  const query = parsed.success
    ? parsed.data
    : catalogQuerySchema.parse({ limit: 12 });
  const listings = useListings(query, parsed.success);
  const pageLink = (cursor?: string) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (cursor) next.set('cursor', cursor);
    return `/browse?${next}`;
  };

  return (
    <section className="catalog-page" aria-labelledby="browse-title">
      <div className="section-heading">
        <div>
          <h1 id="browse-title">Browse</h1>
          <p>Find something with a little more life to give.</p>
        </div>
      </div>
      <form
        ref={form}
        className="catalog-filters"
        key={params.toString()}
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const next = new URLSearchParams();
          for (const [name, value] of fields) {
            if (typeof value === 'string' && value.trim())
              next.set(name, value.trim());
          }
          setParams(next);
        }}
      >
        <label className="catalog-search" htmlFor="catalog-search">
          Search items
          <Input
            id="catalog-search"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={params.get('q') ?? ''}
            placeholder="Titles and descriptions"
          />
        </label>
        <label htmlFor="catalog-condition">
          Condition
          <Select
            id="catalog-condition"
            name="condition"
            defaultValue={params.get('condition') ?? ''}
          >
            <option value="">Any condition</option>
            {Object.entries(conditions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor="catalog-availability">
          Availability
          <Select
            id="catalog-availability"
            name="availability"
            defaultValue={query.availability}
          >
            <option value="available">Available</option>
            <option value="all">All public items</option>
            <option value="reserved">Reserved</option>
            <option value="exchanged">Exchanged</option>
            <option value="disputed">Disputed</option>
          </Select>
        </label>
        <label htmlFor="catalog-sort">
          Sort
          <Select id="catalog-sort" name="sort" defaultValue={query.sort}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </label>
        {query.owner && (
          <input type="hidden" name="owner" value={query.owner} />
        )}
        <Button type="submit">Search</Button>
        <Link to="/browse">Clear filters</Link>
      </form>
      {!parsed.success ? (
        <div className="panel route-panel">
          <p role="alert">
            These catalog filters are invalid. Clear the filters and try again.
          </p>
        </div>
      ) : listings.isPending ? (
        <p role="status">Loading items…</p>
      ) : listings.isError ? (
        <>
          <ListingRetry retry={() => void listings.refetch()} />
          {query.cursor && (
            <Link to={pageLink()}>Start from the first page</Link>
          )}
        </>
      ) : (
        <>
          {listings.data.items.length ? (
            <CatalogGrid items={listings.data.items} />
          ) : (
            <div className="panel route-panel">
              <h2>No items to show yet</h2>
              <p>
                No items match these filters. Try another search or clear the
                filters.
              </p>
            </div>
          )}
          <nav className="catalog-pagination" aria-label="Catalog pages">
            {query.cursor && <Link to={pageLink()}>First page</Link>}
            {listings.data.nextCursor && (
              <Link to={pageLink(listings.data.nextCursor)}>Next page</Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
