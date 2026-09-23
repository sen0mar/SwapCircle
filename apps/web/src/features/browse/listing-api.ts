import { listingPageSchema, listingSchema } from '@swapcircle/contracts';
import { apiRequest } from '../../lib/api-client';

export function getListings(cursor: string, signal: AbortSignal) {
  const query = new URLSearchParams({ limit: '12' });

  if (cursor) query.set('cursor', cursor);

  return apiRequest(`/api/v1/listings?${query}`, listingPageSchema, { signal });
}

export function getListing(id: string, signal: AbortSignal) {
  return apiRequest(
    `/api/v1/listings/${encodeURIComponent(id)}`,
    listingSchema,
    { signal },
  );
}
