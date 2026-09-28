import type { Pool, PoolClient } from 'pg';

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
