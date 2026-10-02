import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProposalCreation,
  ProposalRevision,
  TradeAcceptance,
  TradeTransition,
} from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import {
  acceptTrade,
  createTrade,
  getMyTrades,
  getTrade,
  getTradeVersion,
  reviseTrade,
  transitionTrade,
} from './trades-api';

export function useMyTrades(after: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'my-trades', after],
    queryFn: ({ signal }) => getMyTrades(request, after, signal),
    enabled: !!session,
    retry: false,
    refetchInterval: 30_000,
  });
}

export function useTrade(id: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'trade', id],
    queryFn: ({ signal }) => getTrade(request, id, signal),
    enabled: !!session && !!id,
    retry: false,
    refetchInterval: 30_000,
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

export function useTradeVersion(id: string, version: number) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'trade-version', id, version],
    queryFn: ({ signal }) => getTradeVersion(request, id, version, signal),
    enabled: !!session && version > 0,
    retry: false,
  });
}

export function useReviseTrade(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (input: ProposalRevision) => reviseTrade(request, id, input),
    onSuccess: async () => {
      const root = ['private', session?.user.id];

      await Promise.all([
        queries.invalidateQueries({ queryKey: [...root, 'trade', id] }),
        queries.invalidateQueries({ queryKey: [...root, 'my-trades'] }),
        queries.invalidateQueries({ queryKey: [...root, 'group'] }),
        queries.invalidateQueries({ queryKey: [...root, 'inbox'] }),
      ]);
    },
  });
}

export function useAcceptTrade(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (input: TradeAcceptance) => acceptTrade(request, id, input),
    onSettled: async () => {
      const root = ['private', session?.user.id];

      await Promise.all([
        ...['trade', 'my-trades', 'my-listings', 'notifications'].map((key) =>
          queries.invalidateQueries({ queryKey: [...root, key] }),
        ),
        ...['listing', 'listings', 'proposal-items'].map((key) =>
          queries.invalidateQueries({ queryKey: [key] }),
        ),
      ]);
    },
  });
}

export function useTradeTransition(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: ({
      action,
      ...input
    }: TradeTransition & { action: 'decline' | 'cancel' }) =>
      transitionTrade(request, id, action, input),
    onSettled: async () => {
      const root = ['private', session?.user.id];

      await Promise.all([
        ...[
          'trade',
          'my-trades',
          'my-listings',
          'notifications',
          'coffee',
          'meeting',
        ].map((key) => queries.invalidateQueries({ queryKey: [...root, key] })),
        ...['listing', 'listings', 'proposal-items'].map((key) =>
          queries.invalidateQueries({ queryKey: [key] }),
        ),
      ]);
    },
  });
}
