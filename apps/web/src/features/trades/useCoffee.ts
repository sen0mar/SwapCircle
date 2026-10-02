import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import {
  getCoffee,
  getCoffeeEligibility,
  getCoffeeInvitation,
  saveCoffeeAction,
  type CoffeeAction,
} from './coffee-api';

export function useCoffee(tradeId: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'coffee', tradeId],
    queryFn: ({ signal }) => getCoffee(request, tradeId, signal),
    enabled: !!session && !!tradeId,
    retry: false,
  });
}

export function useCoffeeEligibility(tradeId: string, inviteeId: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: [
      'private',
      session?.user.id,
      'coffee-eligibility',
      tradeId,
      inviteeId,
    ],
    queryFn: ({ signal }) =>
      getCoffeeEligibility(request, tradeId, inviteeId, signal),
    enabled: !!session && !!tradeId && !!inviteeId,
    retry: false,
  });
}

export function useCoffeeAction(tradeId: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (input: CoffeeAction) =>
      saveCoffeeAction(request, tradeId, input),
    onSettled: async () => {
      await Promise.all(
        ['coffee', 'coffee-eligibility', 'trade', 'notifications'].map((key) =>
          queries.invalidateQueries({
            queryKey: ['private', session?.user.id, key],
          }),
        ),
      );
    },
  });
}

export function useCoffeeInvitation(id: string) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'coffee-invitation', id],
    queryFn: ({ signal }) => getCoffeeInvitation(request, id, signal),
    enabled: !!session && !!id,
    retry: false,
  });
}
