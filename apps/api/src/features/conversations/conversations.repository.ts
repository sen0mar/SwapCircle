import type { Pool, PoolClient } from 'pg';
import type { MessageReceipt, MessageSubmission } from '@swapcircle/contracts';

export class ConversationsRepository {
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

  async identity(client: PoolClient, id: string) {
    const result = await client.query<{
      type: 'direct' | 'group';
      direct_user_low: string | null;
      direct_user_high: string | null;
    }>(
      'SELECT type,direct_user_low,direct_user_high FROM public.conversations WHERE id=$1',
      [id],
    );
    return result.rows[0];
  }

  async activeMembers(client: PoolClient, id: string) {
    // Account locks always precede this lock, including across retry conversations.
    await client.query(
      'SELECT id FROM public.conversations WHERE id=$1 FOR NO KEY UPDATE',
      [id],
    );
    const result = await client.query<{ user_id: string }>(
      'SELECT user_id FROM public.conversation_members WHERE conversation_id=$1 AND active',
      [id],
    );
    return result.rows.map((row) => row.user_id);
  }

  async retryMessage(client: PoolClient, actor: string, key: string) {
    const result = await client.query<MessageReceipt>(
      `SELECT id,conversation_id,sender_id,body,client_message_id,message_order,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM public.messages WHERE sender_id=$1 AND client_message_id=$2`,
      [actor, key],
    );
    return result.rows[0];
  }

  async insertMessage(
    client: PoolClient,
    actor: string,
    input: MessageSubmission,
  ) {
    // The existing trigger allocates the position while holding the conversation
    // row until commit; neither timestamps nor sequences determine history order.
    await client.query(
      'INSERT INTO public.messages (conversation_id,sender_id,body,client_message_id) VALUES ($1,$2,$3,$4)',
      [input.conversation_id, actor, input.body, input.client_message_id],
    );
    return (await this.retryMessage(client, actor, input.client_message_id))!;
  }

  async memberExists(client: PoolClient, user: string) {
    return Boolean(
      (await client.query('SELECT 1 FROM public.profiles WHERE id=$1', [user]))
        .rowCount,
    );
  }

  async findDirect(client: PoolClient, low: string, high: string) {
    const result = await client.query<{ id: string; active: boolean }>(
      `SELECT c.id, (SELECT count(*)=2 FROM public.conversation_members m
        WHERE m.conversation_id=c.id AND m.active AND m.user_id IN ($1,$2)) AS active
       FROM public.conversations c WHERE direct_user_low=$1 AND direct_user_high=$2`,
      [low, high],
    );
    return result.rows[0];
  }

  async createDirect(client: PoolClient, low: string, high: string) {
    const result = await client.query<{ id: string }>(
      "INSERT INTO public.conversations (type,direct_user_low,direct_user_high) VALUES ('direct',$1,$2) RETURNING id",
      [low, high],
    );
    const id = result.rows[0]!.id;

    await client.query(
      'INSERT INTO public.conversation_members (conversation_id,user_id) VALUES ($1,$2),($1,$3)',
      [id, low, high],
    );
    return id;
  }
}
