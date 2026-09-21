import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { getIdentity } from './account-api';

export function useIdentity() {
  const { session, request } = useAuth();
  return useQuery({
    queryKey: ['private', session?.user.id, 'identity'],
    queryFn: ({ signal }) => getIdentity(request, signal),
    enabled: !!session,
    retry: false,
  });
}
