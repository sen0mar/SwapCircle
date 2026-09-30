import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProposalCreation } from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import { createTrade, getMyTrades, getTrade } from './trades-api';

export function useMyTrades(after: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'my-trades', after],
    queryFn: ({ signal }) => getMyTrades(request, after, signal),
    enabled: !!session,
    retry: false,
  });
}

export function useTrade(id: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'trade', id],
    queryFn: ({ signal }) => getTrade(request, id, signal),
    enabled: !!session && !!id,
    retry: false,
  });
}

export function useCreateTrade() {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (input: ProposalCreation) => createTrade(request, input),
    onSuccess: (result) => {
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'my-trades'],
      });
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'trade', result.id],
      });
    },
  });
}
