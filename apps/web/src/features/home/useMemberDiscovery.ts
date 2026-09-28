import { useQuery } from '@tanstack/react-query';
import type { MemberQuery } from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import { apiRequest } from '../../lib/api-client';
import { getMembers } from './discovery-api';

export function useMemberDiscovery(query: MemberQuery, valid: boolean) {
  const { session, request, loading } = useAuth();
  const personalized = !!session;
  const members = useQuery({
    queryKey: ['member-discovery', session?.user.id ?? 'public', query],
    queryFn: ({ signal }) =>
      getMembers(
        query,
        personalized,
        personalized ? request : apiRequest,
        signal,
      ),
    enabled: valid && !loading,
    retry: false,
  });

  return { members, personalized };
}
