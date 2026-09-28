import type { Pool, PoolClient } from 'pg';
import type { BlockQuery, ReportSubmission } from '@swapcircle/contracts';

export class SafetyRepository {
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

  async provision(client: PoolClient, actor: string) {
    await client.query(
      "INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Member') ON CONFLICT DO NOTHING",
      [actor],
    );
  }

  async ownBlocks(actor: string, query: BlockQuery) {
    const result = await this.pool.query<{ userId: string; createdAt: string }>(
      `SELECT blocked_id AS "userId", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
       FROM public.blocks WHERE blocker_id=$1 AND ($2::uuid IS NULL OR blocked_id > $2)
       ORDER BY blocked_id LIMIT $3`,
      [actor, query.after ?? null, query.limit + 1],
    );
    return result.rows;
  }

  async memberExists(client: PoolClient, id: string) {
    return Boolean(
      (await client.query('SELECT 1 FROM public.profiles WHERE id=$1', [id]))
        .rowCount,
    );
  }

  async targetExists(client: PoolClient, input: ReportSubmission) {
    return input.targetType === 'member'
      ? this.memberExists(client, input.targetId)
      : Boolean(
          (
            await client.query(
              "SELECT 1 FROM public.listings WHERE id=$1 AND availability <> 'withdrawn'",
              [input.targetId],
            )
          ).rowCount,
        );
  }

  async hasOwnBlock(client: PoolClient, actor: string, other: string) {
    return Boolean(
      (
        await client.query(
          'SELECT 1 FROM public.blocks WHERE blocker_id=$1 AND blocked_id=$2',
          [actor, other],
        )
      ).rowCount,
    );
  }

  async block(client: PoolClient, actor: string, other: string) {
    await client.query(
      'INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1,$2)',
      [actor, other],
    );
  }

  async unblock(client: PoolClient, actor: string, other: string) {
    await client.query(
      'DELETE FROM public.blocks WHERE blocker_id=$1 AND blocked_id=$2',
      [actor, other],
    );
  }

  async retryReport(client: PoolClient, actor: string, key: string) {
    // Serialize even before the retry row exists; retries do not consume another allowance.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`report:${actor}:${key}`],
    );
    const result = await client.query<{
      id: string;
      createdAt: string;
      reportedUserId: string | null;
      listingId: string | null;
      reason: string;
    }>(
      `SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
       reported_user_id AS "reportedUserId", listing_id AS "listingId", reason FROM public.reports
       WHERE reporter_id=$1 AND client_report_id=$2`,
      [actor, key],
    );
    return result.rows[0];
  }

  async report(client: PoolClient, actor: string, input: ReportSubmission) {
    const result = await client.query<{ id: string; createdAt: string }>(
      `INSERT INTO public.reports (reporter_id, client_report_id, reported_user_id, listing_id, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`,
      [
        actor,
        input.clientReportId,
        input.targetType === 'member' ? input.targetId : null,
        input.targetType === 'listing' ? input.targetId : null,
        input.reason,
      ],
    );
    return result.rows[0]!;
  }
}
