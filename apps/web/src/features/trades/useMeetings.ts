import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { getMeeting, saveMeeting, type MeetingAction } from './meetings-api';

export function useMeeting(id: string, byTrade = true) {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, byTrade ? 'meeting' : 'meetup', id],
    queryFn: ({ signal }) => getMeeting(request, id, signal, byTrade),
    enabled: !!session && !!id,
    retry: false,
  });
}

export function useMeetingAction(id: string) {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (action: MeetingAction) => saveMeeting(request, id, action),
    onSettled: async () => {
      await Promise.all(
        ['meeting', 'meetup', 'trade', 'notifications'].map((key) =>
          queries.invalidateQueries({
            queryKey: ['private', session?.user.id, key],
          }),
        ),
      );
    },
  });
}
