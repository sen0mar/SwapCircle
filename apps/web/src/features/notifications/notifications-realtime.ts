import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import { notificationsKey } from './notifications-api';

export function startNotificationsRealtime({
  client,
  queries,
  userId,
  signal,
  status,
}: {
  client: SupabaseClient;
  queries: QueryClient;
  userId: string;
  signal: AbortSignal;
  status: (value: string | null) => void;
}) {
  let stopped = false;
  let pending = false;
  let running = false;
  let connected = false;
  const key = notificationsKey(userId);

  const reconcile = async () => {
    if (stopped || signal.aborted) return;
    pending = true;
    if (running) return;
    running = true;

    try {
      while (pending && !stopped && !signal.aborted) {
        pending = false;
        // An older in-flight snapshot must not erase a just-committed change.
        await queries.cancelQueries({ queryKey: key, exact: true });
        if (stopped || signal.aborted) return;
        await queries.invalidateQueries(
          { queryKey: key, exact: true },
          { throwOnError: true },
        );
        if (!stopped && !signal.aborted && connected) status(null);
      }
    } catch {
      if (!stopped && !signal.aborted)
        status('Notifications could not be refreshed. Please retry.');
    } finally {
      running = false;
      if (pending && !stopped && !signal.aborted) void reconcile();
    }
  };
  const channel = client
    .channel(`notifications:${userId}`, {
      config: { postgres_changes_options: { wait: true } },
    })
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      () => void reconcile(),
    )
    .subscribe((value) => {
      if (stopped || signal.aborted) return;
      connected = value === 'SUBSCRIBED';
      if (connected) void reconcile();
      else
        status('Live notifications are reconnecting. You can retry the list.');
    });
  const wake = () => void reconcile();
  const timer = setInterval(wake, 30000);
  globalThis.addEventListener('online', wake);
  globalThis.addEventListener('focus', wake);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    globalThis.removeEventListener('online', wake);
    globalThis.removeEventListener('focus', wake);
    signal.removeEventListener('abort', stop);
    void client.removeChannel(channel);
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();

  return { stop, retry: wake };
}
