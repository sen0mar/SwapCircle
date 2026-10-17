import { TradesRepository } from '../trades/trades.repository.js';
import { SafetyPermissions } from '../safety/safety.permissions.js';
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
  constructor(
    private readonly pool: Pool,
    readonly permissions = new SafetyPermissions(),
  ) {}

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

  async reviseProposals(client: PoolClient, id: string, actor: string) {
    return new TradesRepository(this.pool).reviseListingProposals(
      client,
      id,
      actor,
    );
  }

  async frozenTerms(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT 1 FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
       JOIN public.trades t ON t.id=v.trade_id WHERE i.listing_id=$1 AND v.version=t.current_version
       AND t.status IN ('confirmed','completed','disputed') LIMIT 1`,
      [id],
    );
    return Boolean(result.rowCount);
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
    const ascending =
      (query.sort === 'oldest') !== (query.direction === 'previous');
    const direction = ascending ? 'ASC' : 'DESC';
    const comparison = ascending ? '>' : '<';
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

  async pagination(query: CatalogQuery, first?: ListingCursor) {
    const comparison = query.sort === 'oldest' ? '<' : '>';
    const result = await this.pool.query<{ page: number; totalPages: number }>(
      `SELECT
        (count(*) FILTER (WHERE (created_at, id) ${comparison} ($2::timestamptz, $3::uuid)) / $1::bigint + 1)::integer AS page,
        greatest(1, (count(*) + $1::bigint - 1) / $1::bigint)::integer AS "totalPages"
      FROM public.listings
      WHERE availability <> 'withdrawn'
        AND ($4 = 'all' OR availability = $4)
        AND ($5::text IS NULL OR condition = $5)
        AND ($6 = '' OR to_tsvector('english', title || ' ' || description) @@ websearch_to_tsquery('english', $6))
        AND ($7::uuid IS NULL OR owner_id = $7)`,
      [
        query.limit,
        first?.createdAt ?? null,
        first?.id ?? null,
        query.availability,
        query.condition ?? null,
        query.q,
        query.owner ?? null,
      ],
    );

    return result.rows[0]!;
  }

  async lastPage(query: CatalogQuery) {
    const direction = query.sort === 'oldest' ? 'ASC' : 'DESC';
    // Count and select from one snapshot so a partial final page keeps the
    // same boundaries as forward navigation, including concurrent changes.
    const result = await this.pool.query<Listing & { hasPrevious: boolean }>(
      `WITH filtered AS (
        SELECT * FROM public.listings
        WHERE availability <> 'withdrawn'
          AND ($2 = 'all' OR availability = $2)
          AND ($3::text IS NULL OR condition = $3)
          AND ($4 = '' OR to_tsvector('english', title || ' ' || description) @@ websearch_to_tsquery('english', $4))
          AND ($5::uuid IS NULL OR owner_id = $5)
      ), counted AS (
        SELECT *, count(*) OVER () AS total FROM filtered
      )
      SELECT ${projection}, total > $1 AS "hasPrevious" FROM counted
      ORDER BY created_at ${direction}, id ${direction}
      OFFSET (SELECT CASE WHEN count(*) = 0 THEN 0
        ELSE ((count(*) - 1) / $1::bigint) * $1::bigint END FROM filtered)`,
      [
        query.limit,
        query.availability,
        query.condition ?? null,
        query.q,
        query.owner ?? null,
      ],
    );

    return {
      items: result.rows.map((row) => {
        const { hasPrevious, ...item } = row;
        void hasPrevious;

        return item;
      }),
      hasPrevious: result.rows[0]?.hasPrevious ?? false,
    };
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
