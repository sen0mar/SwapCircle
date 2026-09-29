import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';
import { messageReadSchema, type MessageRead } from '@swapcircle/contracts';
import {
  authorizeRead,
  ConversationDenied,
  historyPageSize,
  readConversation,
  readHistory,
  readMessagesAfter,
} from './inbox-api';
import { mergeMessage, type HistoryData } from './message-cache';

export function startInboxRealtime({
  client,
  queries,
  userId,
  id,
  signal: identitySignal,
  status,
}: {
  client: SupabaseClient;
  queries: QueryClient;
  userId: string;
  id?: string | undefined;
  signal: AbortSignal;
  status: (value: string | null) => void;
}) {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([identitySignal, lifetime.signal]);
  const threadKey = ['private', userId, 'thread', id];
  const historyKey = [...threadKey, 'history'];
  const inboxKey = ['private', userId, 'inbox'];
  let pending = false;
  let running = false;
  let hints: MessageRead[] = [];

  const reconcile = async () => {
    pending = true;
    if (running || signal.aborted) return;
    running = true;

    try {
      while (pending && !signal.aborted) {
        pending = false;
        const received = hints;
        hints = [];
        const readScope = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
        const sdk = await authorizeRead(client, userId, readScope);

        if (id) {
          // Cancel reads begun before the event so late snapshots cannot erase it.
          await queries.cancelQueries({ queryKey: historyKey, exact: true });
          await queries.fetchQuery({
            queryKey: [...threadKey, 'access'],
            queryFn: () => readConversation(sdk, id, readScope),
            staleTime: 0,
            retry: false,
          });
          const current = queries.getQueryData<HistoryData>(historyKey);
          let recovered: MessageRead[] = [];
          let initial: Awaited<ReturnType<typeof readHistory>> | undefined;

          if (current) {
            // Start at the oldest loaded position, not the highest event/receipt.
            // This also repairs a missing lower-order row when delivery is out of order.
            const positions = current.pages.flatMap((page) =>
              page.items.map((message) => message.message_order),
            );
            let cursor = positions.length ? Math.min(...positions) - 1 : 0;
            let page: MessageRead[];

            do {
              page = await readMessagesAfter(sdk, id, cursor, readScope);
              recovered.push(...page);
              cursor = page.at(-1)?.message_order ?? cursor;
            } while (page.length === historyPageSize);
          } else {
            initial = await readHistory(sdk, id, undefined, readScope);
            recovered = initial.items;
          }
          // Check access again after multi-page recovery before revealing results.
          await readConversation(sdk, id, readScope);
          readScope.throwIfAborted();
          queries.setQueryData<HistoryData>(historyKey, (latest) => {
            let merged = latest ?? {
              pages: [initial ?? { items: [], nextCursor: undefined }],
              pageParams: [undefined],
            };

            for (const message of [...recovered, ...received])
              merged = mergeMessage(merged, message);

            return merged;
          });
          void queries.invalidateQueries({
            queryKey: [...threadKey, 'profiles'],
          });
        }
        readScope.throwIfAborted();
        await queries.invalidateQueries({ queryKey: inboxKey });
        if (!signal.aborted) status(null);
      }
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof ConversationDenied) {
          await queries.cancelQueries({ queryKey: threadKey });
          if (signal.aborted) return;
          queries.setQueryData<HistoryData>(historyKey, {
            pages: [{ items: [], nextCursor: undefined }],
            pageParams: [undefined],
          });
          queries.removeQueries({ queryKey: [...threadKey, 'profiles'] });
          void queries.invalidateQueries({
            queryKey: [...threadKey, 'access'],
          });
          void queries.invalidateQueries({ queryKey: inboxKey });
        } else
          status(
            'Live updates could not be refreshed. Retry or refresh history.',
          );
      }
    } finally {
      running = false;
      if (pending && !signal.aborted) void reconcile();
    }
  };
  const channel = client
    .channel(`inbox:${userId}:${id ?? 'list'}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        if (signal.aborted) return;
        const parsed = messageReadSchema.safeParse(payload.new);
        if (!parsed.success) return;
        if (parsed.data.conversation_id === id) hints.push(parsed.data);
        void reconcile();
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'conversations' },
      () => {
        if (!signal.aborted) void reconcile();
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_members',
        filter: `user_id=eq.${userId}`,
      },
      () => {
        if (!signal.aborted) void reconcile();
      },
    )
    .subscribe((value) => {
      if (signal.aborted) return;
      if (value === 'SUBSCRIBED') void reconcile();
      else status('Live updates are reconnecting. You can refresh history.');
    });
  // RLS may suppress events after restrictions/deletions. Revalidate even on a
  // quiet connection; focus/online recovery handles missed events without reload.
  const timer = setInterval(() => void reconcile(), 30000);
  const wake = () => void reconcile();
  globalThis.addEventListener('online', wake);
  globalThis.addEventListener('focus', wake);

  return {
    retry: wake,
    stop: () => {
      lifetime.abort();
      clearInterval(timer);
      globalThis.removeEventListener('online', wake);
      globalThis.removeEventListener('focus', wake);
      void client.removeChannel(channel);
    },
  };
}
