import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileUpdate } from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import {
  getCurrentProfile,
  getInterests,
  saveCurrentProfile,
} from './profile-api';

export function useCurrentProfile() {
  const { session, request } = useAuth();

  return useQuery({
    queryKey: ['private', session?.user.id, 'profile'],
    queryFn: ({ signal }) => getCurrentProfile(request, signal),
    enabled: !!session,
    retry: false,
  });
}

export function useInterests() {
  return useQuery({
    queryKey: ['interests'],
    queryFn: ({ signal }) => getInterests(signal),
    retry: false,
  });
}

export function useSaveProfile() {
  const { session, request } = useAuth();
  const queries = useQueryClient();

  return useMutation({
    mutationFn: (update: ProfileUpdate) => saveCurrentProfile(request, update),
    onSuccess: (profile) => {
      queries.setQueryData(['private', session?.user.id, 'profile'], profile);
      void queries.invalidateQueries({ queryKey: ['member', profile.id] });
      void queries.invalidateQueries({ queryKey: ['member-discovery'] });
    },
  });
}
