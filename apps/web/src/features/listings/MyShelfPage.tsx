import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { conditions } from '../browse/ListingContent';
import { ApiError } from '../../lib/api-client';
import { useMyListings, useWithdrawListing } from './useMyListings';
import type { Listing } from '@swapcircle/contracts';

const availability: Record<Listing['availability'], string> = {
  available: 'Available',
  withdrawn: 'Withdrawn',
  reserved: 'Reserved',
  exchanged: 'Exchanged',
  disputed: 'Disputed',
};

export function MyShelfPage() {
  const [params] = useSearchParams();
  const cursor = params.get('cursor') ?? '';
  const listings = useMyListings(cursor);
  const withdraw = useWithdrawListing();
  const [selected, setSelected] = useState<Listing | null>(null);

  return (
    <section className="shelf-page" aria-labelledby="shelf-title">
      <div className="section-heading">
        <div>
          <h1 id="shelf-title">My Shelf</h1>
          <p>Manage the items you have shared.</p>
        </div>
        <Button asChild variant="primary">
          <Link to="/listings/new">List an item</Link>
        </Button>
      </div>
      {listings.isPending ? (
        <p role="status">Loading your items…</p>
      ) : listings.isError ? (
        <div className="panel route-panel">
          <p role="alert">Your items could not be loaded.</p>
          <Button onClick={() => void listings.refetch()}>Retry</Button>
        </div>
      ) : listings.data.items.length === 0 ? (
        <div className="panel route-panel">
          <h2>No items yet</h2>
          <p>Share an item to see it here.</p>
        </div>
      ) : (
        <>
          <div className="shelf-grid">
            {listings.data.items.map((item) => (
              <Card key={item.id} className="shelf-item">
                <h2>{item.title}</h2>
                <p>
                  {conditions[item.condition]} ·{' '}
                  {availability[item.availability]}
                </p>
                <div className="shelf-actions">
                  {item.availability !== 'withdrawn' && (
                    <Link to={`/listings/${item.id}`}>View item</Link>
                  )}
                  {item.availability === 'available' && (
                    <>
                      <Link to={`/listings/${item.id}/edit`}>Edit</Link>
                      <Button
                        onClick={() => {
                          withdraw.reset();
                          setSelected(item);
                        }}
                      >
                        Withdraw
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <nav className="catalog-pagination" aria-label="My Shelf pages">
            {cursor && <Link to="/shelf">First page</Link>}
            {listings.data.nextCursor && (
              <Link
                to={`/shelf?${new URLSearchParams({ cursor: listings.data.nextCursor })}`}
              >
                Next page
              </Link>
            )}
          </nav>
        </>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !withdraw.isPending) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Withdraw item?</DialogTitle>
          <DialogDescription>
            {selected?.title} will no longer appear in Browse. This action
            cannot be undone.
          </DialogDescription>
          {withdraw.isError && (
            <p role="alert">
              {withdraw.error instanceof ApiError &&
              withdraw.error.code === 'STALE_REVISION'
                ? 'This item changed. Close this dialog and reload My Shelf before trying again.'
                : 'Withdrawal failed. The item is still on your shelf. Retry or close this dialog.'}
            </p>
          )}
          <div className="shelf-actions">
            <Button
              onClick={() => setSelected(null)}
              disabled={withdraw.isPending}
            >
              Keep item
            </Button>
            <Button
              variant="primary"
              disabled={withdraw.isPending}
              onClick={() => {
                if (!selected) return;

                void withdraw
                  .mutateAsync({ id: selected.id, revision: selected.revision })
                  .then(() => setSelected(null))
                  .catch(() => {});
              }}
            >
              {withdraw.isPending ? 'Withdrawing…' : 'Confirm withdrawal'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
