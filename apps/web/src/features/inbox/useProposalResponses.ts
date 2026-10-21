import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  messageProposalStateSchema,
  type MessageProposalState,
} from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';

export function useProposalResponse(
  messageId: string,
  known?: MessageProposalState,
) {
  const { request, session } = useAuth();
  const queries = useQueryClient();
  const key = ['private', session?.user.id, 'proposal-response', messageId];
  const state = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      request(
        `/api/v1/conversations/messages/${messageId}/proposal`,
        messageProposalStateSchema,
        { signal },
      ),
    enabled: !!session && !known,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 15000 : false,
  });
  const respond = useMutation({
    mutationFn: (action: 'accept' | 'refuse') =>
      request(
        `/api/v1/conversations/messages/${messageId}/proposal`,
        messageProposalStateSchema,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      ),
    onSuccess: async (saved) => {
      await queries.cancelQueries({ queryKey: key, exact: true });
      queries.setQueryData(key, saved);
    },
    onSettled: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: key, exact: true }),
        ...['accepted-proposals', 'my-trades', 'notifications', 'inbox'].map(
          (name) =>
            queries.invalidateQueries({
              queryKey: ['private', session?.user.id, name],
            }),
        ),
      ]);
    },
  });

  return { state, respond, response: known ?? state.data };
}
