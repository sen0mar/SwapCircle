import type { Pool, PoolClient } from 'pg';
import {
  notificationCreationSchema,
  type NotificationCreation,
} from '@swapcircle/contracts';

// Called only with the domain service's existing transaction. Never begins or
// commits a separate transaction; a domain rollback also removes its notification.
// Reuse the persisted domain-event UUID for every retry, with one row per recipient.
export async function createNotification(
  client: PoolClient,
  input: NotificationCreation,
): Promise<string> {
  const value = notificationCreationSchema.parse(input);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO public.notifications (recipient_id,domain_event_id,event_type,resource_type,resource_id)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (domain_event_id,recipient_id) DO NOTHING RETURNING id`,
    [
      value.recipient_id,
      value.domain_event_id,
      value.event_type,
      value.resource_type,
      value.resource_id,
    ],
  );

  if (inserted.rows[0]) return inserted.rows[0].id;

  // The unique constraint waits for concurrent creators. A subsequent statement
  // sees their committed row without resetting its original creation/read state.
  const existing = await client.query<{
    id: string;
    event_type: string;
    resource_type: string;
    resource_id: string;
  }>(
    'SELECT id,event_type,resource_type,resource_id FROM public.notifications WHERE domain_event_id=$1 AND recipient_id=$2',
    [value.domain_event_id, value.recipient_id],
  );
  const row = existing.rows[0];

  if (
    !row ||
    row.event_type !== value.event_type ||
    row.resource_type !== value.resource_type ||
    row.resource_id !== value.resource_id
  )
    throw new Error('Notification domain event retry conflict');

  return row.id;
}

export class NotificationsRepository {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async owned(client: PoolClient, actor: string, ids: string[]) {
    const result = await client.query(
      `SELECT id FROM public.notifications WHERE recipient_id=$1 AND id=ANY($2::uuid[])
       ORDER BY id FOR UPDATE`,
      [actor, ids],
    );

    return result.rowCount === ids.length;
  }

  async markRead(client: PoolClient, actor: string, ids: string[]) {
    const result = await client.query<{ id: string; read_at: string }>(
      `UPDATE public.notifications SET read_at=COALESCE(read_at,statement_timestamp())
       WHERE recipient_id=$1 AND id=ANY($2::uuid[])
       RETURNING id,to_char(read_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_at`,
      [actor, ids],
    );

    return { items: result.rows };
  }
}
