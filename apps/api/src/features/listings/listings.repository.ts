import type { Pool, PoolClient } from 'pg';
import type {
  CatalogQuery,
  Listing,
  ListingCreate,
  ListingCursor,
} from '@swapcircle/contracts';

const projection = `id, owner_id AS "ownerId", title, description, condition, availability, revision,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export class ListingsRepository {
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

  async restricted(client: PoolClient, actor: string) {
    const result = await client.query(
      'SELECT 1 FROM public.account_restrictions WHERE user_id = $1',
      [actor],
    );

    return Boolean(result.rowCount);
  }

  async create(client: PoolClient, actor: string, input: ListingCreate) {
    await client.query(
      "INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Member') ON CONFLICT DO NOTHING",
      [actor],
    );

    const result = await client.query<Listing>(
      `INSERT INTO public.listings (owner_id, title, description, condition)
      VALUES ($1, $2, $3, $4) RETURNING ${projection}`,
      [actor, input.title, input.description, input.condition],
    );

    return result.rows[0]!;
  }

  async lock(client: PoolClient, id: string) {
    const result = await client.query<Listing>(
      `SELECT ${projection} FROM public.listings WHERE id = $1 FOR UPDATE`,
      [id],
    );

    return result.rows[0];
  }

  async edit(client: PoolClient, id: string, input: ListingCreate) {
    const result = await client.query<Listing>(
      `UPDATE public.listings SET title=$2, description=$3, condition=$4,
      revision=revision+1, updated_at=now() WHERE id=$1 RETURNING ${projection}`,
      [id, input.title, input.description, input.condition],
    );

    return result.rows[0]!;
  }

  async withdraw(client: PoolClient, id: string) {
    const result = await client.query<Listing>(
      `UPDATE public.listings SET availability='withdrawn',
      revision=revision+1, updated_at=now() WHERE id=$1 RETURNING ${projection}`,
      [id],
    );

    return result.rows[0]!;
  }

  async publicListing(id: string) {
    const result = await this.pool.query<Listing>(
      `SELECT ${projection} FROM public.listings WHERE id=$1 AND availability <> 'withdrawn'`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async page(query: CatalogQuery, cursor?: ListingCursor) {
    // Only validated enum values choose SQL operators; all user values are parameters.
    const direction = query.sort === 'oldest' ? 'ASC' : 'DESC';
    const comparison = query.sort === 'oldest' ? '>' : '<';
    const result = await this.pool.query<Listing>(
      `SELECT ${projection} FROM public.listings
      WHERE availability <> 'withdrawn'
        AND ($4 = 'all' OR availability = $4)
        AND ($5::text IS NULL OR condition = $5)
        AND ($6 = '' OR to_tsvector('english', title || ' ' || description) @@ websearch_to_tsquery('english', $6))
        AND ($7::uuid IS NULL OR owner_id = $7)
        AND ($2::timestamptz IS NULL OR (created_at, id) ${comparison} ($2::timestamptz, $3::uuid))
      ORDER BY created_at ${direction}, id ${direction} LIMIT $1`,
      [
        query.limit + 1,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        query.availability,
        query.condition ?? null,
        query.q,
        query.owner ?? null,
      ],
    );

    return result.rows;
  }

  async ownerPage(actor: string, limit: number, cursor?: ListingCursor) {
    const result = await this.pool.query<Listing>(
      `SELECT ${projection} FROM public.listings
      WHERE owner_id=$1 AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $2`,
      [actor, limit + 1, cursor?.createdAt ?? null, cursor?.id ?? null],
    );

    return result.rows;
  }
}
