import { useQuery } from '@tanstack/react-query';
import { getListing, getListings } from './listing-api';
import { getPublicProfile } from '../account/profile-api';

export function useListings(cursor: string) {
  return useQuery({
    queryKey: ['listings', cursor],
    queryFn: ({ signal }) => getListings(cursor, signal),
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
