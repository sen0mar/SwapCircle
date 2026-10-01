import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { getGroup, respondGroup } from './groups-api';

export function useGroup(id: string, enabled = true) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'group', id],
    queryFn: ({ signal }) => getGroup(request, id, signal),
    enabled: !!session && !!id && enabled,
    retry: false,
  });
}

export function useGroupResponse(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (action: 'accept' | 'decline' | 'leave') =>
      respondGroup(request, id, action),
    onSuccess: async (result) => {
      const root = ['private', session?.user.id];
      if (!result.active) {
        await queries.cancelQueries({ queryKey: [...root, 'thread', id] });
        queries.removeQueries({ queryKey: [...root, 'thread', id] });
      }
      await Promise.all([
        queries.invalidateQueries({ queryKey: [...root, 'group', id] }),
        queries.invalidateQueries({ queryKey: [...root, 'inbox'] }),
      ]);
    },
    onError: () => {
      void queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'group', id],
      });
    },
  });
}
