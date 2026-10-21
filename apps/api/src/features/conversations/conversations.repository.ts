import type { Pool, PoolClient } from 'pg';
import type {
  GroupMembershipStatus,
  MessageReceipt,
  MessageSubmission,
  MessageProposal,
} from '@swapcircle/contracts';

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

  async groupInvitation(client: PoolClient, actor: string, id: string) {
    const result = await client.query(
      `SELECT c.id AS "conversationId", c.trade_id AS "tradeId", m.status, m.active
       FROM public.conversations c JOIN public.conversation_members m ON m.conversation_id=c.id
       JOIN public.trade_participants p ON p.trade_id=c.trade_id AND p.user_id=m.user_id
       WHERE c.id=$1 AND c.type='group' AND m.user_id=$2 AND p.active`,
      [id, actor],
    );
    if (!result.rows[0]) return null;

    const members = await client.query(
      `SELECT m.user_id AS "userId", p.display_name AS "displayName", m.status, m.active
       FROM public.conversation_members m JOIN public.profiles p ON p.id=m.user_id
       WHERE m.conversation_id=$1 ORDER BY m.user_id`,
      [id],
    );

    return { ...result.rows[0], members: members.rows };
  }

  async groupMembership(client: PoolClient, actor: string, id: string) {
    // Sends, reads and transitions all hold this lock until commit. Membership
    // SELECT needs no UPDATE privilege; the private transition function owns it.
    const group = await client.query(
      "SELECT id FROM public.conversations WHERE id=$1 AND type='group' AND trade_id IS NOT NULL FOR NO KEY UPDATE",
      [id],
    );
    if (!group.rowCount) return null;

    const result = await client.query<{
      status: GroupMembershipStatus;
      active: boolean;
    }>(
      `SELECT m.status,m.active FROM public.conversation_members m JOIN public.conversations c ON c.id=m.conversation_id
       JOIN public.trade_participants p ON p.trade_id=c.trade_id AND p.user_id=m.user_id
       WHERE m.conversation_id=$1 AND m.user_id=$2 AND p.active`,
      [id, actor],
    );

    return result.rows[0] ?? null;
  }

  async respondGroup(
    client: PoolClient,
    actor: string,
    id: string,
    status: GroupMembershipStatus,
  ) {
    await client.query('SELECT private.respond_group_membership($1,$2,$3)', [
      id,
      actor,
      status,
    ]);
    const event = await client.query<{ id: string }>(
      'INSERT INTO public.conversation_membership_events (conversation_id,actor_id,event_type) VALUES ($1,$2,$3) RETURNING id',
      [id, actor, status],
    );

    return event.rows[0]!.id;
  }

  async lockReader(client: PoolClient, actor: string, id: string) {
    const result = await client.query<{ allowed: boolean }>(
      'SELECT private.lock_conversation_reader($1,$2) AS allowed',
      [id, actor],
    );
    return result.rows[0]?.allowed ?? false;
  }

  async readState(client: PoolClient, actor: string, id: string) {
    const result = await client.query<{
      lastViewedOrder: number;
      unreadCount: number;
    }>(
      `SELECT COALESCE((SELECT last_viewed_order FROM public.conversation_reads WHERE conversation_id=$1 AND user_id=$2),0) AS "lastViewedOrder",
      (SELECT count(*)::int FROM public.messages WHERE conversation_id=$1 AND sender_id<>$2 AND message_order>COALESCE((SELECT last_viewed_order FROM public.conversation_reads WHERE conversation_id=$1 AND user_id=$2),0)) AS "unreadCount"`,
      [id, actor],
    );
    return result.rows[0]!;
  }

  async advanceRead(
    client: PoolClient,
    actor: string,
    id: string,
    message: string,
  ) {
    const result = await client.query(
      `INSERT INTO public.conversation_reads (conversation_id,user_id,last_viewed_order)
       SELECT $1,$2,message_order FROM public.messages WHERE conversation_id=$1 AND id=$3
       ON CONFLICT (conversation_id,user_id) DO UPDATE SET last_viewed_order=GREATEST(conversation_reads.last_viewed_order,EXCLUDED.last_viewed_order)
       RETURNING last_viewed_order`,
      [id, actor, message],
    );
    return !!result.rowCount;
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
      `SELECT id,conversation_id,sender_id,body,client_message_id,has_photo,proposal,message_order,
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
    photo?: { sourceDigest: string; photoBase64: string },
    proposal?: MessageProposal,
  ) {
    // The existing trigger allocates the position while holding the conversation
    // row until commit; neither timestamps nor sequences determine history order.
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO public.messages (conversation_id,sender_id,body,client_message_id,has_photo,proposal) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [
        input.conversation_id,
        actor,
        input.body,
        input.client_message_id,
        !!photo,
        proposal ? JSON.stringify(proposal) : null,
      ],
    );
    if (photo) {
      await client.query(
        'INSERT INTO public.message_photos (message_id,source_digest,photo_base64) VALUES ($1,$2,$3)',
        [inserted.rows[0]!.id, photo.sourceDigest, photo.photoBase64],
      );
    }
    return (await this.retryMessage(client, actor, input.client_message_id))!;
  }

  async proposalListing(id: string) {
    const result = await this.pool.query<{
      owner_id: string;
      title: string;
      availability: string;
    }>('SELECT owner_id,title,availability FROM public.listings WHERE id=$1', [
      id,
    ]);
    return result.rows[0];
  }

  async photo(client: PoolClient, messageId: string) {
    const result = await client.query<{
      photo_base64: string;
      source_digest: string;
    }>(
      'SELECT photo_base64,source_digest FROM public.message_photos WHERE message_id=$1',
      [messageId],
    );
    return result.rows[0];
  }

  async messageConversation(client: PoolClient, messageId: string) {
    const result = await client.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM public.messages WHERE id=$1',
      [messageId],
    );
    return result.rows[0]?.conversation_id;
  }

  async proposalMessage(client: PoolClient, id: string) {
    const result = await client.query<MessageReceipt>(
      `SELECT id,conversation_id,sender_id,body,client_message_id,has_photo,proposal,message_order,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM public.messages WHERE id=$1 AND proposal IS NOT NULL`,
      [id],
    );
    return result.rows[0];
  }

  async proposalDecision(client: PoolClient, messageId: string) {
    const result = await client.query<{
      id: string;
      decision: 'accepted' | 'refused';
      respondedAt: string;
    }>(
      `SELECT id,decision,to_char(responded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "respondedAt"
       FROM public.message_proposal_responses WHERE message_id=$1`,
      [messageId],
    );
    return result.rows[0];
  }

  async insertProposalDecision(
    client: PoolClient,
    actor: string,
    messageId: string,
    decision: 'accepted' | 'refused',
  ) {
    await client.query(
      'INSERT INTO public.message_proposal_responses (message_id,actor_id,decision) VALUES ($1,$2,$3)',
      [messageId, actor, decision],
    );
    return (await this.proposalDecision(client, messageId))!;
  }

  async proposalTarget(client: PoolClient, listingId: string) {
    const result = await client.query<{
      owner_id: string;
      availability: string;
      title: string;
      updated_at: Date;
    }>(
      'SELECT owner_id,availability,title,updated_at FROM public.listings WHERE id=$1 FOR SHARE',
      [listingId],
    );
    return result.rows[0];
  }

  async acceptedProposals(
    client: PoolClient,
    actor: string,
    input: {
      limit: number;
      before?: string | undefined;
      beforeId?: string | undefined;
    },
  ) {
    const result = await client.query<{
      id: string;
      respondedAt: string;
      recipientId: string;
      senderName: string;
      recipientName: string;
      message: MessageReceipt;
    }>(
      `
      SELECT r.id,to_char(r.responded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "respondedAt",
        r.actor_id AS "recipientId",sender.display_name AS "senderName",recipient.display_name AS "recipientName",
        jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'sender_id',m.sender_id,'body',m.body,
          'client_message_id',m.client_message_id,'has_photo',m.has_photo,'proposal',m.proposal,'message_order',m.message_order,
          'created_at',to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS message
      FROM public.message_proposal_responses r JOIN public.messages m ON m.id=r.message_id
      JOIN public.conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1 AND cm.active
      JOIN public.profiles sender ON sender.id=m.sender_id JOIN public.profiles recipient ON recipient.id=r.actor_id
      WHERE r.decision='accepted' AND (m.sender_id=$1 OR r.actor_id=$1)
        AND ($2::timestamptz IS NULL OR (r.responded_at,r.id)<($2::timestamptz,$3::uuid))
      ORDER BY r.responded_at DESC,r.id DESC LIMIT $4`,
      [actor, input.before ?? null, input.beforeId ?? null, input.limit + 1],
    );
    const items = result.rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => ({
        message: row.message,
        senderName: row.senderName,
        recipientName: row.recipientName,
        response: {
          messageId: row.message.id,
          conversationId: row.message.conversation_id,
          recipientId: row.recipientId,
          status: 'accepted',
          respondedAt: row.respondedAt,
        },
      })),
      nextCursor:
        result.rows.length > input.limit && last
          ? { respondedAt: last.respondedAt, id: last.id }
          : null,
    };
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
