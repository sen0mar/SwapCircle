import {
  listingPageSchema,
  listingSchema,
  type ListingCreate,
  type ListingUpdate,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export function getMyListings(
  request: typeof apiRequest,
  cursor: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ limit: '12' });

  if (cursor) query.set('cursor', cursor);

  return request(`/api/v1/listings/mine?${query}`, listingPageSchema, {
    signal,
  });
}

export function createListing(
  request: typeof apiRequest,
  input: ListingCreate,
) {
  return request('/api/v1/listings', listingSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function editListing(
  request: typeof apiRequest,
  id: string,
  input: ListingUpdate,
) {
  return request(`/api/v1/listings/${encodeURIComponent(id)}`, listingSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function withdrawListing(
  request: typeof apiRequest,
  id: string,
  revision: number,
) {
  return request(
    `/api/v1/listings/${encodeURIComponent(id)}/withdraw`,
    listingSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision }),
    },
  );
}
