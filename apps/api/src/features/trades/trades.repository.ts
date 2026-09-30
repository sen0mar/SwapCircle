import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { tradeDetailSchema, tradePageSchema } from '@swapcircle/contracts';
import type { ProposalCreation } from '@swapcircle/contracts';

type TradeDetail = z.infer<typeof tradeDetailSchema>;
type TradePage = z.infer<typeof tradePageSchema>;

const summarySql = `SELECT t.id, t.creator_id AS "creatorId",
  CASE WHEN t.status='proposed' AND t.expires_at <= statement_timestamp() THEN 'expired' ELSE t.status END AS status,
  t.current_version AS "currentVersion", t.expires_at AS "expiresAt",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM public.trade_participants p WHERE p.trade_id=t.id) AS "participantCount",
  (SELECT count(*)::int FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
   WHERE v.trade_id=t.id AND v.version=t.current_version) AS "itemCount"
  FROM public.trades t`;

export class TradesRepository {
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

  async lockOperation(client: PoolClient, actor: string, key: string) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`trade-operation:${actor}:${key}`],
    );
  }

  async operation(client: PoolClient, actor: string, key: string) {
    const result = await client.query<{
      id: string;
      operation_hash: string;
      currentVersion: number;
      status: string;
    }>(
      `SELECT id,operation_hash,current_version AS "currentVersion",
       CASE WHEN status='proposed' AND expires_at <= statement_timestamp() THEN 'expired' ELSE status END AS status
       FROM public.trades WHERE creator_id=$1 AND operation_key=$2`,
      [actor, key],
    );
    return result.rows[0] ?? null;
  }

  async lockParticipants(client: PoolClient, ids: string[]) {
    for (const id of [...ids].sort())
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`safety:${id}`],
      );
  }

  async blocked(client: PoolClient, ids: string[]) {
    const result = await client.query(
      `SELECT 1 FROM public.blocks WHERE blocker_id=ANY($1::uuid[])
       AND blocked_id=ANY($1::uuid[]) LIMIT 1`,
      [ids],
    );
    return Boolean(result.rowCount);
  }

  async existingParticipants(client: PoolClient, ids: string[]) {
    const result = await client.query(
      'SELECT id FROM public.profiles WHERE id=ANY($1::uuid[])',
      [ids],
    );
    return result.rowCount ?? 0;
  }

  async availableListings(client: PoolClient, ids: string[]) {
    const result = await client.query<{
      id: string;
      owner_id: string;
      availability: string;
      revision: number;
      title: string;
      description: string;
      condition: string;
    }>(
      `SELECT id,owner_id,availability,revision,title,description,condition
       FROM public.listings WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
    return new Map(result.rows.map((row) => [row.id, row]));
  }

  async insertProposal(
    client: PoolClient,
    actor: string,
    input: ProposalCreation,
    hash: string,
    listings: Map<
      string,
      {
        revision: number;
        title: string;
        description: string;
        condition: string;
      }
    >,
  ) {
    const trade = await client.query<{ id: string }>(
      `INSERT INTO public.trades (creator_id,operation_key,operation_hash,expires_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [actor, input.operationKey, hash, input.expiresAt],
    );
    const tradeId = trade.rows[0]!.id;

    for (const id of input.participantIds)
      await client.query(
        `INSERT INTO public.trade_participants (trade_id,user_id,invitation_status)
         VALUES ($1,$2,$3)`,
        [tradeId, id, id === actor ? 'joined' : 'invited'],
      );

    const version = await client.query<{ id: string }>(
      `INSERT INTO public.trade_versions (trade_id,version,created_by)
       VALUES ($1,1,$2) RETURNING id`,
      [tradeId, actor],
    );
    const versionId = version.rows[0]!.id;

    for (const transfer of input.transfers) {
      const listing = listings.get(transfer.listingId)!;
      await client.query(
        `INSERT INTO public.trade_items
         (trade_id,version_id,listing_id,owner_id,recipient_id,listing_revision,title_snapshot,description_snapshot,condition_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tradeId,
          versionId,
          transfer.listingId,
          transfer.ownerId,
          transfer.recipientId,
          listing.revision,
          listing.title,
          listing.description,
          listing.condition,
        ],
      );
    }

    const event = await client.query<{ id: string }>(
      `INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type)
       VALUES ($1,$2,$3,'proposed') RETURNING id`,
      [tradeId, versionId, actor],
    );
    return { tradeId, eventId: event.rows[0]!.id };
  }

  async read<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
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

  async restricted(client: PoolClient, actor: string): Promise<boolean> {
    const result = await client.query(
      'SELECT 1 FROM public.account_restrictions WHERE user_id=$1',
      [actor],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async page(
    client: PoolClient,
    actor: string,
    limit: number,
    after?: string,
  ): Promise<TradePage> {
    const result = await client.query(
      `${summarySql}
       WHERE EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND p.user_id=$1)
         AND ($2::uuid IS NULL OR t.id < $2::uuid)
       ORDER BY t.id DESC LIMIT $3`,
      [actor, after ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit);

    return tradePageSchema.parse(
      JSON.parse(
        JSON.stringify({
          items,
          nextAfter: hasMore ? items.at(-1)?.id : null,
        }),
      ),
    );
  }

  async detail(
    client: PoolClient,
    actor: string,
    id: string,
  ): Promise<TradeDetail | null> {
    const trade = await client.query(
      `${summarySql}
       WHERE t.id=$1 AND EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND p.user_id=$2)`,
      [id, actor],
    );
    if (!trade.rows[0]) return null;

    const participants = await client.query(
      `SELECT p.user_id AS "userId", u.display_name AS "displayName",
        p.invitation_status AS "invitationStatus", p.invited_at AS "invitedAt",
        p.responded_at AS "respondedAt", p.accepted_version AS "acceptedVersion",
        p.accepted_at AS "acceptedAt"
       FROM public.trade_participants p JOIN public.profiles u ON u.id=p.user_id
       WHERE p.trade_id=$1 ORDER BY p.user_id`,
      [id],
    );
    const items = await client.query(
      `SELECT i.id, i.listing_id AS "listingId", i.owner_id AS "ownerId",
        i.recipient_id AS "recipientId", i.listing_revision AS "listingRevision",
        i.title_snapshot AS "titleSnapshot", i.description_snapshot AS "descriptionSnapshot",
        i.condition_snapshot AS "conditionSnapshot"
       FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
       JOIN public.trades t ON t.id=v.trade_id
       WHERE t.id=$1 AND v.version=t.current_version ORDER BY i.id`,
      [id],
    );
    const events = await client.query(
      `SELECT e.id, v.version, e.actor_id AS "actorId", e.event_type AS "eventType",
        e.created_at AS "createdAt"
       FROM public.trade_events e JOIN public.trade_versions v ON v.id=e.version_id
       WHERE e.trade_id=$1 ORDER BY e.created_at, e.id`,
      [id],
    );

    return tradeDetailSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...trade.rows[0],
          participants: participants.rows,
          items: items.rows,
          events: events.rows,
        }),
      ),
    );
  }
}
