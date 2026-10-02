import type { Pool, PoolClient } from 'pg';
import { coffeeInvitationSchema } from '@swapcircle/contracts';
import { TradesRepository } from '../trades/trades.repository.js';

const projection = `id, trade_id AS "tradeId", inviter_id AS "inviterId",
  invitee_id AS "inviteeId", offer_to_pay AS "offerToPay", status,
  created_at AS "createdAt", responded_at AS "respondedAt"`;

export class CoffeeRepository {
  readonly trades: TradesRepository;

  constructor(pool: Pool) {
    this.trades = new TradesRepository(pool);
  }

  async sharedInterests(client: PoolClient, first: string, second: string) {
    // Profile edits lock these same rows before replacing interests.
    await client.query(
      'SELECT id FROM public.profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[first, second]],
    );
    const result = await client.query<{ id: string; name: string }>(
      `SELECT DISTINCT i.id,i.name FROM public.interests i
       JOIN public.profile_interests a ON a.interest_id=i.id AND a.profile_id=$1
       JOIN public.profile_interests b ON b.interest_id=i.id AND b.profile_id=$2
       ORDER BY i.name,i.id`,
      [first, second],
    );
    return result.rows;
  }

  async operation(client: PoolClient, actor: string, key: string) {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM public.coffee_invitations WHERE inviter_id=$1 AND operation_key=$2',
      [actor, key],
    );
    return result.rows[0]?.id;
  }

  async activePair(client: PoolClient, trade: string, a: string, b: string) {
    const result = await client.query(
      `SELECT id FROM public.coffee_invitations WHERE trade_id=$1
       AND least(inviter_id,invitee_id)=least($2::uuid,$3::uuid)
       AND greatest(inviter_id,invitee_id)=greatest($2::uuid,$3::uuid)
       AND status IN ('pending','accepted')`,
      [trade, a, b],
    );
    return Boolean(result.rowCount);
  }

  async invitation(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT ${projection} FROM public.coffee_invitations WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ? this.parse(result.rows[0]) : null;
  }

  async list(client: PoolClient, tradeId: string) {
    const result = await client.query(
      `SELECT ${projection} FROM public.coffee_invitations WHERE trade_id=$1 ORDER BY created_at,id`,
      [tradeId],
    );
    return result.rows.map((row) => this.parse(row));
  }

  async insert(
    client: PoolClient,
    trade: string,
    inviter: string,
    invitee: string,
    key: string,
    offer: boolean,
  ) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO public.coffee_invitations (trade_id,inviter_id,invitee_id,operation_key,offer_to_pay)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [trade, inviter, invitee, key, offer],
    );
    return (await this.invitation(client, result.rows[0]!.id))!;
  }

  async respond(
    client: PoolClient,
    id: string,
    status: 'accepted' | 'declined' | 'cancelled',
  ) {
    await client.query(
      'UPDATE public.coffee_invitations SET status=$2,responded_at=clock_timestamp() WHERE id=$1',
      [id, status],
    );
    return (await this.invitation(client, id))!;
  }

  private parse(row: Record<string, unknown>) {
    return coffeeInvitationSchema.parse({
      ...row,
      createdAt: (row.createdAt as Date).toISOString(),
      respondedAt: (row.respondedAt as Date | null)?.toISOString() ?? null,
    });
  }
}
