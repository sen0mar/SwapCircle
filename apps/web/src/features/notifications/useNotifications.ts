import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { authorizeRead } from '../inbox/inbox-api';
import {
  markNotificationsRead,
  notificationsKey,
  readNotifications,
} from './notifications-api';
import { startNotificationsRealtime } from './notifications-realtime';

export function useNotifications() {
  const { session, client, readSignal } = useAuth();
  const userId = session?.user.id ?? '';

  return useQuery({
    queryKey: notificationsKey(userId),
    queryFn: async ({ signal: querySignal }) => {
      const signal = AbortSignal.any([
        querySignal,
        readSignal,
        AbortSignal.timeout(15000),
      ]);
      const sdk = await authorizeRead(client, userId, signal);

      return readNotifications(sdk, userId, signal);
    },
    enabled: !!userId,
    retry: false,
    gcTime: 0,
  });
}

export function useNotificationAcknowledgement() {
  const { request, session, readSignal } = useAuth();
  const queries = useQueryClient();
  const key = notificationsKey(session?.user.id ?? '');
  const mutation = useMutation({
    mutationFn: ({ ids, all }: { ids: readonly string[]; all: boolean }) =>
      markNotificationsRead(request, ids, readSignal, all),
    onSettled: async () => {
      if (!readSignal.aborted)
        await queries.invalidateQueries({ queryKey: key, exact: true });
    },
    retry: false,
  });

  return {
    ...mutation,
    retry: () => {
      if (mutation.variables) mutation.mutate(mutation.variables);
    },
  };
}

// Mounted once by the shared header, including while the panel is closed.
export function useNotificationsRealtime() {
  const { client, session, readSignal } = useAuth();
  const queries = useQueryClient();
  const userId = session?.user.id;
  const [status, setStatus] = useState<string | null>(null);
  const connection = useRef<ReturnType<
    typeof startNotificationsRealtime
  > | null>(null);

  useEffect(() => {
    if (!client || !userId) return;
    setStatus('Connecting live notifications…');
    const live = startNotificationsRealtime({
      client,
      queries,
      userId,
      signal: readSignal,
      status: setStatus,
    });
    connection.current = live;

    return () => {
      live.stop();
      connection.current = null;
    };
  }, [client, userId, readSignal, queries]);

  return { status, retry: () => connection.current?.retry() };
}
