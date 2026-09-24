import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Listing,
  ListingCreate,
  ListingUpdate,
} from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import {
  createListing,
  editListing,
  getMyListings,
  withdrawListing,
} from './listing-api';

export function useMyListings(cursor: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'my-listings', cursor],
    queryFn: ({ signal }) => getMyListings(request, cursor, signal),
    enabled: !!session,
    retry: false,
  });
}

function useListingSuccess() {
  const { session } = useAuth();
  const queries = useQueryClient();

  return (listing: Listing) => {
    if (listing.availability === 'withdrawn') {
      queries.removeQueries({ queryKey: ['listing', listing.id], exact: true });
    } else {
      queries.setQueryData(['listing', listing.id], listing);
      void queries.invalidateQueries({
        queryKey: ['listing', listing.id],
        exact: true,
      });
    }
    void queries.invalidateQueries({ queryKey: ['listings'] });
    void queries.invalidateQueries({
      queryKey: ['private', session?.user.id, 'my-listings'],
    });
  };
}

export function useCreateListing() {
  const { request } = useAuth();
  const onSuccess = useListingSuccess();

  return useMutation({
    mutationFn: (input: ListingCreate) => createListing(request, input),
    onSuccess,
  });
}

export function useEditListing(id: string) {
  const { request } = useAuth();
  const onSuccess = useListingSuccess();

  return useMutation({
    mutationFn: (input: ListingUpdate) => editListing(request, id, input),
    onSuccess,
  });
}

export function useWithdrawListing() {
  const { request } = useAuth();
  const onSuccess = useListingSuccess();

  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      withdrawListing(request, id, revision),
    onSuccess,
  });
}
