import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { getPublicProfile } from '../account/profile-api';
import {
  authorizeRead,
  directPeer,
  readConversation,
  readConversations,
  readHistory,
  readUnread,
} from './inbox-api';

export function useInbox() {
  const { session, client, readSignal, request } = useAuth();
  const userId = session?.user.id ?? '';

  return useInfiniteQuery({
    queryKey: ['private', userId, 'inbox'],
    initialPageParam: undefined as
      { createdAt: string; id: string } | undefined,
    queryFn: async ({ signal: querySignal, pageParam }) => {
      const signal = AbortSignal.any([
        querySignal,
        readSignal,
        AbortSignal.timeout(15000),
      ]);
      const sdk = await authorizeRead(client, userId, signal);
      const page = await readConversations(sdk, pageParam, signal);
      const items = await Promise.all(
        page.items.map(async (conversation) => {
          const peer = directPeer(conversation, userId);
          const [profile, history, unread] = await Promise.all([
            peer ? getPublicProfile(peer, signal).catch(() => null) : null,
            readHistory(sdk, conversation.id, undefined, signal, 1),
            readUnread(request, conversation.id, signal).catch(
              (error: unknown) => {
                if (
                  signal.aborted ||
                  (error instanceof ApiError &&
                    (error.status === 401 || error.status === 403))
                )
                  throw error;
                return null;
              },
            ),
          ]);
          return {
            conversation,
            profile,
            latest: history.items[0],
            unreadCount: unread?.unreadCount ?? null,
          };
        }),
      );
      signal.throwIfAborted();

      return { items, nextCursor: page.nextCursor };
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!userId,
    retry: false,
    gcTime: 0,
  });
}

export function useThread(id: string) {
  const { session, client, readSignal } = useAuth();
  const userId = session?.user.id ?? '';
  const key = ['private', userId, 'thread', id];
  const conversation = useQuery({
    queryKey: [...key, 'access'],
    queryFn: async ({ signal: querySignal }) => {
      const signal = AbortSignal.any([
        querySignal,
        readSignal,
        AbortSignal.timeout(15000),
      ]);
      const sdk = await authorizeRead(client, userId, signal);

      return readConversation(sdk, id, signal);
    },
    retry: false,
    gcTime: 0,
  });
  const history = useInfiniteQuery({
    queryKey: [...key, 'history'],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ signal: querySignal, pageParam }) => {
      const signal = AbortSignal.any([
        querySignal,
        readSignal,
        AbortSignal.timeout(15000),
      ]);
      const sdk = await authorizeRead(client, userId, signal);
      // Empty message results alone cannot distinguish an empty thread from RLS denial.
      await readConversation(sdk, id, signal);

      return readHistory(sdk, id, pageParam, signal);
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: conversation.isSuccess && !conversation.isFetching,
    // Receipts and authorized Realtime recovery maintain the loaded union.
    // Automatic latest-page refetch can truncate it during access revalidation.
    // Access keeps revalidating separately; explicit refresh/pagination still read.
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  });
  const messages = [
    ...new Map(
      (history.data?.pages.flatMap((page) => page.items) ?? []).map(
        (message) => [message.id, message],
      ),
    ).values(),
  ].sort((a, b) => a.message_order - b.message_order);
  const peer = conversation.data ? directPeer(conversation.data, userId) : null;
  const ids = [
    ...new Set([
      ...(peer ? [peer] : []),
      ...messages.map((message) => message.sender_id),
    ]),
  ].sort();
  const profiles = useQuery({
    queryKey: [...key, 'profiles', ids],
    queryFn: async ({ signal }) =>
      new Map(
        await Promise.all(
          ids.map(
            async (profileId) =>
              [
                profileId,
                await getPublicProfile(profileId, signal).catch(() => null),
              ] as const,
          ),
        ),
      ),
    enabled: !!ids.length && conversation.isSuccess,
    gcTime: 0,
  });

  return {
    conversation,
    history,
    messages,
    profiles: profiles.data,
    peer,
    userId,
  };
}
