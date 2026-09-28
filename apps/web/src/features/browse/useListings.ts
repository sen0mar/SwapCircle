import type { CatalogQuery } from '@swapcircle/contracts';
import { useQuery } from '@tanstack/react-query';
import { getListing, getListings } from './listing-api';
import { getPublicProfile } from '../account/profile-api';

export function useListings(
  filters: Partial<CatalogQuery> | string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['listings', filters],
    queryFn: ({ signal }) => getListings(filters, signal),
    enabled,
    retry: false,
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: ['listing', id],
    queryFn: ({ signal }) => getListing(id, signal),
    retry: false,
  });
}

export function useListingOwner(id: string) {
  return useQuery({
    queryKey: ['member', id],
    queryFn: ({ signal }) => getPublicProfile(id, signal),
    enabled: !!id,
    retry: false,
  });
}
