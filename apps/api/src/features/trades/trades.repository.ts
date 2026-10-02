import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import {
  tradeDetailSchema,
  tradePageSchema,
  tradeVersionSchema,
  tradeAcceptanceResultSchema,
} from '@swapcircle/contracts';
import type { ProposalCreation, ProposalRevision } from '@swapcircle/contracts';

type TradeDetail = z.infer<typeof tradeDetailSchema>;
type TradePage = z.infer<typeof tradePageSchema>;

const summarySql = `SELECT t.id, t.creator_id AS "creatorId",
  CASE WHEN t.status='proposed' AND t.expires_at <= statement_timestamp() THEN 'expired' ELSE t.status END AS status,
  t.current_version AS "currentVersion", t.expires_at AS "expiresAt",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM public.trade_participants p WHERE p.trade_id=t.id AND p.active) AS "participantCount",
  (SELECT count(*)::int FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
   WHERE v.trade_id=t.id AND v.version=t.current_version) AS "itemCount",
  EXISTS (SELECT 1 FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
   LEFT JOIN public.listings l ON l.id=i.listing_id
   WHERE v.trade_id=t.id AND v.version=t.current_version
     AND l.availability IS DISTINCT FROM 'available') AS "hasUnavailableItems"
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
      `INSERT INTO public.trade_versions (trade_id,version,created_by,participant_ids,expires_at)
       VALUES ($1,1,$2,$3,$4) RETURNING id`,
      [tradeId, actor, input.participantIds, input.expiresAt],
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

  async createGroup(
    client: PoolClient,
    tradeId: string,
    actor: string,
    ids: string[],
  ) {
    const result = await client.query<{ id: string }>(
      "INSERT INTO public.conversations (type,trade_id) VALUES ('group',$1) RETURNING id",
      [tradeId],
    );
    const id = result.rows[0]!.id;

    for (const user of ids)
      await client.query(
        `INSERT INTO public.conversation_members (conversation_id,user_id,active,status)
         VALUES ($1,$2,$3,$4)`,
        [id, user, user === actor, user === actor ? 'accepted' : 'pending'],
      );

    const event = await client.query<{ id: string }>(
      `INSERT INTO public.conversation_membership_events (conversation_id,actor_id,event_type)
       VALUES ($1,$2,'invited') RETURNING id`,
      [id, actor],
    );

    return { id, eventId: event.rows[0]!.id };
  }

  async lockTrade(client: PoolClient, id: string, actor: string) {
    const result = await client.query<{
      current_version: number;
      status: string;
      expires_at: Date;
    }>(
      `SELECT t.current_version,t.status,t.expires_at FROM public.trades t
       WHERE t.id=$1 AND EXISTS (SELECT 1 FROM public.trade_participants p
       WHERE p.trade_id=t.id AND p.user_id=$2 AND p.active) FOR UPDATE`,
      [id, actor],
    );
    return result.rows[0];
  }

  async expired(client: PoolClient, id: string) {
    const result = await client.query<{ expired: boolean }>(
      'SELECT expires_at <= clock_timestamp() AS expired FROM public.trades WHERE id=$1',
      [id],
    );
    return result.rows[0]!.expired;
  }

  async expiringIds(client: PoolClient, actor: string) {
    const result = await client.query<{ id: string }>(
      `SELECT t.id FROM public.trades t WHERE t.status='proposed'
       AND t.expires_at <= clock_timestamp() AND EXISTS
       (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND p.user_id=$1 AND p.active)
       ORDER BY t.id`,
      [actor],
    );
    return result.rows.map((row) => row.id);
  }

  async hasHandover(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT 1 FROM public.trade_events WHERE trade_id=$1
       AND event_type IN ('receipt_acknowledged','handover_reported','disputed','completed') LIMIT 1`,
      [id],
    );
    return result.rowCount !== 0;
  }

  async close(
    client: PoolClient,
    id: string,
    actor: string,
    status: 'declined' | 'expired' | 'cancelled',
  ) {
    // Lock every reserved listing in the same order as final acceptance.
    await client.query(
      `SELECT id FROM public.listings WHERE id IN
       (SELECT listing_id FROM public.item_reservations WHERE trade_id=$1 AND released_at IS NULL)
       ORDER BY id FOR UPDATE`,
      [id],
    );
    await client.query(
      `WITH released AS (
        UPDATE public.item_reservations SET released_at=clock_timestamp()
        WHERE trade_id=$1 AND released_at IS NULL RETURNING listing_id
       ) UPDATE public.listings SET availability='available',updated_at=clock_timestamp()
       WHERE id IN (SELECT listing_id FROM released) AND availability='reserved'`,
      [id],
    );
    if (status === 'declined')
      await client.query(
        `UPDATE public.trade_participants SET invitation_status='declined',responded_at=clock_timestamp()
         WHERE trade_id=$1 AND user_id=$2`,
        [id, actor],
      );
    await client.query(
      'UPDATE public.trades SET status=$2,updated_at=clock_timestamp() WHERE id=$1',
      [id, status],
    );
    const event = await client.query<{ id: string }>(
      `INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type)
       SELECT t.id,v.id,$2,$3 FROM public.trades t JOIN public.trade_versions v
       ON v.trade_id=t.id AND v.version=t.current_version WHERE t.id=$1 RETURNING id`,
      [id, actor, status],
    );
    return event.rows[0]!.id;
  }

  async acceptanceOperation(client: PoolClient, actor: string, key: string) {
    const result = await client.query<{
      trade_id: string;
      version: number;
      result_status: string;
    }>(
      'SELECT trade_id,version,result_status FROM public.trade_acceptance_operations WHERE actor_id=$1 AND operation_key=$2',
      [actor, key],
    );
    return result.rows[0];
  }

  async acceptanceTerms(client: PoolClient, id: string, version: number) {
    const result = await client.query<{
      id: string;
      participant_ids: string[];
      unexpired: boolean;
      expires_match: boolean;
    }>(
      `SELECT v.id,v.participant_ids,v.expires_at>statement_timestamp() AS unexpired,
      v.expires_at=t.expires_at AS expires_match FROM public.trade_versions v
      JOIN public.trades t ON t.id=v.trade_id WHERE v.trade_id=$1 AND v.version=$2`,
      [id, version],
    );
    const items = await client.query<{
      listing_id: string;
      owner_id: string;
      recipient_id: string;
      listing_revision: number;
      title_snapshot: string;
      description_snapshot: string;
      condition_snapshot: string;
    }>(
      `SELECT i.* FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
      WHERE v.trade_id=$1 AND v.version=$2 ORDER BY i.listing_id`,
      [id, version],
    );
    return { version: result.rows[0], items: items.rows };
  }

  async reserved(client: PoolClient, ids: string[]) {
    return Boolean(
      (
        await client.query(
          'SELECT 1 FROM public.item_reservations WHERE listing_id=ANY($1::uuid[]) AND released_at IS NULL LIMIT 1',
          [ids],
        )
      ).rowCount,
    );
  }

  async hasAcceptance(
    client: PoolClient,
    id: string,
    version: number,
    actor: string,
  ) {
    return Boolean(
      (
        await client.query(
          'SELECT 1 FROM public.trade_acceptances WHERE trade_id=$1 AND version=$2 AND actor_id=$3',
          [id, version, actor],
        )
      ).rowCount,
    );
  }

  async insertAcceptance(
    client: PoolClient,
    id: string,
    version: number,
    versionId: string,
    actor: string,
  ) {
    await client.query(
      'INSERT INTO public.trade_acceptances (trade_id,version,actor_id) VALUES ($1,$2,$3)',
      [id, version, actor],
    );
    await client.query(
      `UPDATE public.trade_participants SET accepted_version=$2,accepted_at=statement_timestamp(),invitation_status='joined',responded_at=statement_timestamp()
      WHERE trade_id=$1 AND user_id=$3 AND active`,
      [id, version, actor],
    );
    await client.query(
      `INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type)
      VALUES ($1,$2,$3,'accepted')`,
      [id, versionId, actor],
    );
  }

  async unanimous(client: PoolClient, id: string, version: number) {
    return !(
      await client.query(
        `SELECT 1 FROM public.trade_participants p WHERE p.trade_id=$1 AND p.active
      AND NOT EXISTS (SELECT 1 FROM public.trade_acceptances a WHERE a.trade_id=p.trade_id AND a.actor_id=p.user_id AND a.version=$2)
      LIMIT 1`,
        [id, version],
      )
    ).rowCount;
  }

  async confirm(
    client: PoolClient,
    id: string,
    versionId: string,
    actor: string,
    listingIds: string[],
  ) {
    for (const listingId of [...listingIds].sort())
      await client.query(
        'INSERT INTO public.item_reservations (trade_id,listing_id) VALUES ($1,$2)',
        [id, listingId],
      );
    await client.query(
      `UPDATE public.listings SET availability='reserved',updated_at=statement_timestamp() WHERE id=ANY($1::uuid[])`,
      [listingIds],
    );
    await client.query(
      `UPDATE public.trades SET status='confirmed',updated_at=statement_timestamp() WHERE id=$1`,
      [id],
    );
    const event = await client.query<{ id: string }>(
      `INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type)
      VALUES ($1,$2,$3,'confirmed') RETURNING id`,
      [id, versionId, actor],
    );
    return event.rows[0]!.id;
  }

  async saveAcceptanceOperation(
    client: PoolClient,
    actor: string,
    key: string,
    id: string,
    version: number,
    status: string,
  ) {
    await client.query(
      `INSERT INTO public.trade_acceptance_operations (actor_id,operation_key,trade_id,version,result_status)
      VALUES ($1,$2,$3,$4,$5)`,
      [actor, key, id, version, status],
    );
    return tradeAcceptanceResultSchema.parse({
      id,
      acceptedVersion: version,
      status,
    });
  }

  async participantIds(client: PoolClient, id: string) {
    const result = await client.query<{ user_id: string }>(
      'SELECT user_id FROM public.trade_participants WHERE trade_id=$1 AND active ORDER BY user_id',
      [id],
    );
    return result.rows.map((row) => row.user_id);
  }

  async insertRevision(
    client: PoolClient,
    id: string,
    actor: string,
    input: ProposalRevision,
    listings: Awaited<ReturnType<TradesRepository['availableListings']>>,
  ) {
    await client.query(
      `UPDATE public.trade_participants SET invitation_status=CASE WHEN NOT active AND user_id=ANY($2::uuid[]) THEN 'invited' ELSE invitation_status END,
       active=(user_id=ANY($2::uuid[])),accepted_version=NULL,accepted_at=NULL WHERE trade_id=$1`,
      [id, input.participantIds],
    );
    for (const user of input.participantIds)
      await client.query(
        `INSERT INTO public.trade_participants (trade_id,user_id) VALUES ($1,$2)
         ON CONFLICT (trade_id,user_id) DO UPDATE SET active=true,
         invitation_status=CASE WHEN trade_participants.active THEN trade_participants.invitation_status ELSE 'invited' END`,
        [id, user],
      );
    const version = input.expectedVersion + 1;
    const result = await client.query<{ id: string }>(
      `INSERT INTO public.trade_versions (trade_id,version,created_by,participant_ids,expires_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [id, version, actor, input.participantIds, input.expiresAt],
    );
    const versionId = result.rows[0]!.id;
    for (const transfer of input.transfers) {
      const listing = listings.get(transfer.listingId)!;
      await client.query(
        `INSERT INTO public.trade_items (trade_id,version_id,listing_id,owner_id,recipient_id,
         listing_revision,title_snapshot,description_snapshot,condition_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
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
    await client.query(
      'UPDATE public.trades SET current_version=$2,expires_at=$3,updated_at=now() WHERE id=$1',
      [id, version, input.expiresAt],
    );
    const event = await client.query<{ id: string }>(
      "INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type) VALUES ($1,$2,$3,'revised') RETURNING id",
      [id, versionId, actor],
    );
    return event.rows[0]!.id;
  }

  async reviseListingProposals(
    client: PoolClient,
    listingId: string,
    actor: string,
  ) {
    const affected = await client.query<{
      id: string;
      current_version: number;
      expires_at: Date;
    }>(
      `SELECT t.id,t.current_version,t.expires_at FROM public.trades t
       WHERE t.status='proposed' AND EXISTS (SELECT 1 FROM public.trade_items i
       JOIN public.trade_versions v ON v.id=i.version_id WHERE v.trade_id=t.id
       AND v.version=t.current_version AND i.listing_id=$1) ORDER BY t.id FOR UPDATE`,
      [listingId],
    );
    const events = [];
    for (const trade of affected.rows) {
      const participants = await this.participantIds(client, trade.id);
      const transfers = await client.query<{
        listingId: string;
        ownerId: string;
        recipientId: string;
      }>(
        `SELECT i.listing_id AS "listingId",i.owner_id AS "ownerId",i.recipient_id AS "recipientId"
         FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
         WHERE v.trade_id=$1 AND v.version=$2`,
        [trade.id, trade.current_version],
      );
      const listings = await this.availableListings(
        client,
        transfers.rows.map((row) => row.listingId),
      );
      const eventId = await this.insertRevision(
        client,
        trade.id,
        actor,
        {
          expectedVersion: trade.current_version,
          participantIds: participants,
          transfers: transfers.rows,
          expiresAt: trade.expires_at.toISOString(),
          meetingMode: 'meet_to_swap',
        },
        listings,
      );
      events.push({ tradeId: trade.id, eventId, participants });
    }
    return events;
  }

  async coordinateGroup(
    client: PoolClient,
    id: string,
    actor: string,
    participants: string[],
    added: string[],
  ) {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM public.conversations WHERE trade_id=$1 FOR NO KEY UPDATE',
      [id],
    );
    if (!existing.rows[0]) {
      if (participants.length < 3) return null;
      const group = await this.createGroup(client, id, actor, participants);
      return {
        id: group.id,
        changes: participants
          .filter((user) => user !== actor)
          .map((user) => ({
            user_id: user,
            event_id: group.eventId,
            event_type: 'invited' as const,
          })),
        activeMembers: [actor],
      };
    }
    const groupId = existing.rows[0].id;
    const result = await client.query<{
      user_id: string;
      event_id: string;
      event_type: 'invited' | 'removed';
    }>(
      'SELECT user_id,event_id,event_type FROM private.reconcile_trade_group($1,$2,$3)',
      [groupId, actor, added],
    );
    const members = await client.query<{ user_id: string }>(
      'SELECT user_id FROM public.conversation_members WHERE conversation_id=$1 AND active',
      [groupId],
    );
    return {
      id: groupId,
      changes: result.rows,
      activeMembers: members.rows.map((row) => row.user_id),
    };
  }

  async version(
    client: PoolClient,
    actor: string,
    id: string,
    version: number,
  ) {
    const result = await client.query(
      `SELECT trade_id AS "tradeId", version, participant_ids AS "participantIds", expires_at AS "expiresAt",
       created_by AS "createdBy", created_at AS "createdAt" FROM public.trade_versions
       WHERE trade_id=$1 AND version=$2 AND $3=ANY(participant_ids)`,
      [id, version, actor],
    );
    if (!result.rows[0]) return null;

    const items = await client.query(
      `SELECT i.id,i.listing_id AS "listingId",i.owner_id AS "ownerId",i.recipient_id AS "recipientId",
       i.listing_revision AS "listingRevision",i.title_snapshot AS "titleSnapshot",
       i.description_snapshot AS "descriptionSnapshot",i.condition_snapshot AS "conditionSnapshot",
       l.availability AS "currentAvailability" FROM public.trade_items i
       JOIN public.trade_versions v ON v.id=i.version_id LEFT JOIN public.listings l ON l.id=i.listing_id
       WHERE v.trade_id=$1 AND v.version=$2 ORDER BY i.id`,
      [id, version],
    );
    return tradeVersionSchema.parse(
      JSON.parse(JSON.stringify({ ...result.rows[0], items: items.rows })),
    );
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
       WHERE EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND p.user_id=$1 AND p.active)
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
       WHERE t.id=$1 AND EXISTS (SELECT 1 FROM public.trade_participants p WHERE p.trade_id=t.id AND p.user_id=$2 AND p.active)`,
      [id, actor],
    );
    if (!trade.rows[0]) return null;

    const group = await client.query<{ id: string }>(
      "SELECT id FROM public.conversations WHERE trade_id=$1 AND type='group'",
      [id],
    );

    const participants = await client.query(
      `SELECT p.user_id AS "userId", u.display_name AS "displayName",
        p.invitation_status AS "invitationStatus", p.invited_at AS "invitedAt",
        p.responded_at AS "respondedAt", p.accepted_version AS "acceptedVersion",
        p.accepted_at AS "acceptedAt"
       FROM public.trade_participants p JOIN public.profiles u ON u.id=p.user_id
       WHERE p.trade_id=$1 AND p.active ORDER BY p.user_id`,
      [id],
    );
    const items = await client.query(
      `SELECT i.id, i.listing_id AS "listingId", i.owner_id AS "ownerId",
        i.recipient_id AS "recipientId", i.listing_revision AS "listingRevision",
        i.title_snapshot AS "titleSnapshot", i.description_snapshot AS "descriptionSnapshot",
        i.condition_snapshot AS "conditionSnapshot", l.availability AS "currentAvailability"
       FROM public.trade_items i JOIN public.trade_versions v ON v.id=i.version_id
       JOIN public.trades t ON t.id=v.trade_id
       LEFT JOIN public.listings l ON l.id=i.listing_id
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
          groupConversationId: group.rows[0]?.id ?? null,
          participants: participants.rows,
          items: items.rows,
          events: events.rows,
        }),
      ),
    );
  }
}
