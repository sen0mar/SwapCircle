import {
  listingPageSchema,
  listingSchema,
  type CatalogQuery,
} from '@swapcircle/contracts';
import { apiRequest } from '../../lib/api-client';

export function getListings(
  filters: Partial<CatalogQuery> | string,
  signal: AbortSignal,
) {
  const values = typeof filters === 'string' ? { cursor: filters } : filters;
  const query = new URLSearchParams({ limit: '12' });

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }

  return apiRequest(`/api/v1/listings?${query}`, listingPageSchema, { signal });
}

export function getListing(id: string, signal: AbortSignal) {
  return apiRequest(
    `/api/v1/listings/${encodeURIComponent(id)}`,
    listingSchema,
    { signal },
  );
}
