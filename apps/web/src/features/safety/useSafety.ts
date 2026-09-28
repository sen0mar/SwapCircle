import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ReportSubmission } from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import {
  getBlocks,
  getSafetyStatus,
  setBlock,
  submitReport,
} from './safety-api';

export function useSafetyStatus(userId?: string) {
  const { session, request } = useAuth();
  return useQuery({
    queryKey: ['private', session?.user.id, 'safety', 'status', userId],
    queryFn: ({ signal }) => getSafetyStatus(request, signal, userId),
    enabled: !!session,
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useBlocks() {
  const { session, request } = useAuth();
  return useInfiniteQuery({
    queryKey: ['private', session?.user.id, 'safety', 'blocks'],
    queryFn: ({ signal, pageParam }) => getBlocks(request, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    enabled: !!session,
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useSetBlock() {
  const { session, request } = useAuth();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      setBlock(request, userId, blocked),
    retry: false,
    // Also reconcile an uncertain network result; never guess at the persisted state.
    onSettled: () =>
      queries.invalidateQueries({
        queryKey: ['private', session?.user.id, 'safety'],
      }),
  });
}

export function useReport() {
  const { request } = useAuth();
  return useMutation({
    mutationFn: (input: ReportSubmission) => submitReport(request, input),
    retry: false,
  });
}
