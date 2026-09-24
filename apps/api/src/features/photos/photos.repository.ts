import type { Pool, PoolClient } from 'pg';

export type PhotoRow = {
  id: string;
  listingId: string;
  ownerId: string;
  storageKey: string;
  position: number;
  state: 'pending' | 'active' | 'deleting';
  width: number | null;
  height: number | null;
  bytes: number | null;
};

const projection = `id, listing_id AS "listingId", owner_id AS "ownerId", storage_key AS "storageKey", position, state, width, height, bytes`;

export class PhotosRepository {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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

  async owner(client: PoolClient, listingId: string) {
    const result = await client.query<{
      ownerId: string;
      availability: string;
    }>(
      'SELECT owner_id AS "ownerId", availability FROM public.listings WHERE id=$1 FOR UPDATE',
      [listingId],
    );
    return result.rows[0];
  }

  async restricted(client: PoolClient, actor: string) {
    const result = await client.query(
      'SELECT 1 FROM public.account_restrictions WHERE user_id=$1',
      [actor],
    );
    return Boolean(result.rowCount);
  }

  async occupied(client: PoolClient, listingId: string) {
    const result = await client.query<{ position: number }>(
      'SELECT position FROM public.listing_photos WHERE listing_id=$1 ORDER BY position',
      [listingId],
    );
    return result.rows.map((row) => row.position);
  }

  async reserve(
    client: PoolClient,
    listingId: string,
    actor: string,
    key: string,
    position: number,
  ) {
    const result = await client.query<PhotoRow>(
      `INSERT INTO public.listing_photos (listing_id, owner_id, storage_key, position)
       VALUES ($1,$2,$3,$4) RETURNING ${projection}`,
      [listingId, actor, key, position],
    );
    return result.rows[0]!;
  }

  async activate(id: string, width: number, height: number, bytes: number) {
    const result = await this.pool.query<PhotoRow>(
      `UPDATE public.listing_photos SET state='active', width=$2, height=$3, bytes=$4
       WHERE id=$1 AND state='pending' RETURNING ${projection}`,
      [id, width, height, bytes],
    );
    return result.rows[0];
  }

  async lockPhoto(client: PoolClient, listingId: string, id: string) {
    const result = await client.query<PhotoRow>(
      `SELECT ${projection} FROM public.listing_photos WHERE listing_id=$1 AND id=$2 FOR UPDATE`,
      [listingId, id],
    );
    return result.rows[0];
  }

  async markDeleting(client: PoolClient, id: string) {
    await client.query(
      "UPDATE public.listing_photos SET state='deleting' WHERE id=$1",
      [id],
    );
  }

  async drop(id: string) {
    await this.pool.query('DELETE FROM public.listing_photos WHERE id=$1', [
      id,
    ]);
  }

  async active(listingId: string) {
    const result = await this.pool.query<PhotoRow>(
      `SELECT ${projection} FROM public.listing_photos p
       WHERE p.listing_id=$1 AND p.state='active' AND EXISTS
       (SELECT 1 FROM public.listings l WHERE l.id=p.listing_id AND l.availability <> 'withdrawn')
       ORDER BY p.position`,
      [listingId],
    );
    return result.rows;
  }

  async abandoned(listingId: string) {
    const result = await this.pool.query<PhotoRow>(
      `SELECT ${projection} FROM public.listing_photos
       WHERE listing_id=$1 AND (state='deleting' OR (state='pending' AND created_at < now() - interval '10 minutes'))`,
      [listingId],
    );
    return result.rows;
  }
}
