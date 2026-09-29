import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { startInboxRealtime } from './inbox-realtime';

export function useInboxRealtime(id?: string) {
  const { client, session, readSignal } = useAuth();
  const queries = useQueryClient();
  const userId = session?.user.id;
  const [status, setStatus] = useState<string | null>(null);
  const connection = useRef<ReturnType<typeof startInboxRealtime> | null>(null);

  useEffect(() => {
    if (!client || !userId) return;
    connection.current = startInboxRealtime({
      client,
      queries,
      userId,
      id,
      signal: readSignal,
      status: setStatus,
    });

    return () => {
      connection.current?.stop();
      connection.current = null;
    };
  }, [client, queries, userId, id, readSignal]);

  return { status, retry: () => connection.current?.retry() };
}
