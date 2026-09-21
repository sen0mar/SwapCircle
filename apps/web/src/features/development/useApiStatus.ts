import { useQuery } from '@tanstack/react-query';
import { getApiStatus } from './development-api';

export function useApiStatus() {
  return useQuery({
    queryKey: ['development', 'api-liveness'],
    queryFn: ({ signal }) => getApiStatus(signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
}
