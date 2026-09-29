import type { SupabaseClient } from '@supabase/supabase-js';
import {
  notificationReadSchema,
  notificationsReadReceiptSchema,
  type NotificationRead,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export const notificationsKey = (userId: string) =>
  ['private', userId, 'notifications'] as const;

// Walk immutable creation positions so counts and mark-all include more than one
// PostgREST page. Newer arrivals are picked up by the next reconciliation.
export async function readNotifications(
  client: SupabaseClient,
  userId: string,
  signal: AbortSignal,
) {
  const items = new Map<string, NotificationRead>();
  let cursor: NotificationRead | undefined;

  for (;;) {
    let query = client
      .from('notifications')
      .select(
        'id,recipient_id,domain_event_id,event_type,resource_type,resource_id,created_at,read_at',
      )
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100);
    if (cursor)
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );

    const { data, error } = await query.abortSignal(signal).retry(false);
    signal.throwIfAborted();
    if (error) throw new Error('Notifications unavailable');
    const rows = notificationReadSchema.array().parse(data);
    if (rows.some((row) => row.recipient_id !== userId))
      throw new Error('Notifications unavailable');
    for (const row of rows) items.set(row.id, row);
    if (rows.length < 100) return [...items.values()];
    cursor = rows.at(-1);
  }
}

// Copy and deduplicate before the first await. Retrying uses this same set even
// if Realtime refreshes the cache or new records arrive between batches.
export async function markNotificationsRead(
  request: typeof apiRequest,
  intendedIds: readonly string[],
  signal: AbortSignal,
  all: boolean,
) {
  const ids = [...new Set(intendedIds)];

  for (let offset = 0; offset < ids.length; offset += 100) {
    signal.throwIfAborted();
    const batch = ids.slice(offset, offset + 100);
    await request(
      all ? '/api/v1/notifications/read-all' : '/api/v1/notifications/read',
      notificationsReadReceiptSchema,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          all ? { notification_ids: batch } : { notification_id: batch[0] },
        ),
        signal,
      },
    );
  }
}
