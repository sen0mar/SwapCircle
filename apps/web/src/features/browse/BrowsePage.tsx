import { Select } from '../../components/ui/select';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
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
  const pageLink = (cursor?: string, direction?: 'previous' | 'last') => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    next.delete('direction');
    if (cursor) next.set('cursor', cursor);
    if (direction) next.set('direction', direction);
    return `/browse?${next}`;
  };

  return (
    <section className="catalog-page" aria-labelledby="browse-title">
      <h1 id="browse-title" className="sr-only">
        Browse
      </h1>
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
        <div className="catalog-search">
          <Input
            id="catalog-search"
            aria-label="Search items"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={params.get('q') ?? ''}
            placeholder="Titles and descriptions"
          />
          <Button type="submit" variant="primary">
            Search
          </Button>
        </div>
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
        <div className="catalog-filter-actions">
          <Button asChild>
            <Link to="/browse">
              <RotateCcw size={18} aria-hidden="true" />
              Clear all
            </Link>
          </Button>
        </div>
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
            <div className="catalog-pagination-first">
              <Button
                asChild={!!listings.data.previousCursor}
                disabled={!listings.data.previousCursor}
              >
                {listings.data.previousCursor ? (
                  <Link to={pageLink()}>First page</Link>
                ) : (
                  'First page'
                )}
              </Button>
            </div>
            <div className="catalog-pagination-adjacent">
              {listings.data.previousCursor && (
                <Button
                  asChild
                  variant="primary"
                  className="catalog-page-button"
                >
                  <Link to={pageLink(listings.data.previousCursor, 'previous')}>
                    <ArrowLeft size={18} aria-hidden="true" />
                    Previous
                  </Link>
                </Button>
              )}
              {listings.data.page && listings.data.totalPages && (
                <span
                  className="catalog-page-indicator"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  Page {listings.data.page} of {listings.data.totalPages}
                </span>
              )}
              {listings.data.nextCursor && (
                <Button
                  asChild
                  variant="primary"
                  className="catalog-page-button"
                >
                  <Link to={pageLink(listings.data.nextCursor)}>
                    Next
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
            <div className="catalog-pagination-last">
              <Button
                asChild={!!listings.data.nextCursor}
                disabled={!listings.data.nextCursor}
              >
                {listings.data.nextCursor ? (
                  <Link to={pageLink(undefined, 'last')}>Last page</Link>
                ) : (
                  'Last page'
                )}
              </Button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
