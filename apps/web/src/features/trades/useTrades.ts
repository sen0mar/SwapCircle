import {
  acceptedProposalPageSchema,
  tradeOutcomeResultSchema,
  type AcceptedProposalPage,
} from '@swapcircle/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ProposalCreation,
  ProposalRevision,
  TradeAcceptance,
  TradeTransition,
  TradeProblemSubmission,
} from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import {
  reportTradeProblem,
  acceptTrade,
  createTrade,
  getMyTrades,
  getTrade,
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

export function useTradeProblem(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (input: TradeProblemSubmission) =>
      reportTradeProblem(request, id, input),
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

export function useAcceptedProposals() {
  const { session, request } = useAuth();

  return useInfiniteQuery({
    queryKey: ['private', session?.user.id, 'accepted-proposals'],
    initialPageParam: null as AcceptedProposalPage['nextCursor'],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageParam) {
        params.set('before', pageParam.respondedAt);
        params.set('beforeId', pageParam.id);
      }
      return request(
        `/api/v1/conversations/proposals/accepted?${params}`,
        acceptedProposalPageSchema,
        { signal },
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!session,
    retry: false,
    refetchInterval: 15000,
  });
}

export function useSwapSchedule() {
  const { session, request } = useAuth();

  return useInfiniteQuery({
    queryKey: ['private', session?.user.id, 'my-trades', 'schedule'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) => getMyTrades(request, pageParam, signal),
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    enabled: !!session,
    retry: false,
    refetchInterval: 30_000,
  });
}

export function useConfirmReceipt(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (
      input: import('@swapcircle/contracts').TradeReceiptSubmission,
    ) =>
      request(
        `/api/v1/trades/${encodeURIComponent(id)}/receipt`,
        tradeOutcomeResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
    onSettled: async () => {
      await Promise.all([
        ...['my-trades', 'trade', 'my-listings', 'notifications'].map((key) =>
          queries.invalidateQueries({
            queryKey: ['private', session?.user.id, key],
          }),
        ),
        ...['listing', 'listings', 'proposal-items'].map((key) =>
          queries.invalidateQueries({ queryKey: [key] }),
        ),
      ]);
    },
  });
}
