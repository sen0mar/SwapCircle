import type { Pool, PoolClient } from 'pg';
import {
  meetupSchema,
  type Meetup,
  type MeetingResponse,
} from '@swapcircle/contracts';
import { TradesRepository } from '../trades/trades.repository.js';

export class MeetingsRepository {
  readonly trades: TradesRepository;

  constructor(pool: Pool) {
    this.trades = new TradesRepository(pool);
  }

  async find(client: PoolClient, id: string, byTrade = false) {
    const result = await client.query<{ id: string; trade_id: string }>(
      `SELECT id,trade_id FROM public.meetups WHERE ${byTrade ? 'trade_id' : 'id'}=$1`,
      [id],
    );
    return result.rows[0];
  }

  async read(client: PoolClient, id: string, tradeVersion: number) {
    const result = await client.query<
      Omit<Meetup, 'responses' | 'tradeVersion' | 'meetingAt'> & {
        meetingAt: Date;
      }
    >(
      `SELECT id,trade_id AS "tradeId", revision, place,map_link AS "mapLink",
       meeting_at AS "meetingAt",time_zone AS "timeZone" FROM public.meetups WHERE id=$1`,
      [id],
    );
    const row = result.rows[0]!;
    // Retain consent through unrelated terms changes, but never through a
    // membership gap. Arrangement revisions independently invalidate everyone.
    const responses = await client.query<Meetup['responses'][number]>(
      `SELECT p.user_id AS "userId",r.response FROM public.trade_participants p
       LEFT JOIN LATERAL (
         SELECT saved.response FROM public.meetup_responses saved
         WHERE saved.meetup_id=$1 AND saved.user_id=p.user_id AND saved.revision=$2
         AND saved.trade_version <= $3 AND NOT EXISTS (
           SELECT 1 FROM public.trade_versions v WHERE v.trade_id=p.trade_id
           AND v.version>saved.trade_version AND NOT (p.user_id=ANY(v.participant_ids))
         ) ORDER BY saved.trade_version DESC LIMIT 1
       ) r ON true WHERE p.trade_id=$4 AND p.active ORDER BY p.user_id`,
      [id, row.revision, tradeVersion, row.tradeId],
    );
    return meetupSchema.parse({
      ...row,
      meetingAt: row.meetingAt.toISOString(),
      tradeVersion,
      responses: responses.rows,
    });
  }

  async operation(client: PoolClient, actor: string, key: string) {
    const result = await client.query<{ meetup_id: string; request: unknown }>(
      'SELECT meetup_id,request FROM public.meetup_operations WHERE actor_id=$1 AND operation_key=$2',
      [actor, key],
    );
    return result.rows[0];
  }

  async saveOperation(
    client: PoolClient,
    actor: string,
    key: string,
    id: string,
    input: unknown,
  ) {
    await client.query(
      'INSERT INTO public.meetup_operations (actor_id,operation_key,meetup_id,request) VALUES ($1,$2,$3,$4)',
      [actor, key, id, JSON.stringify(input)],
    );
  }

  async arrange(
    client: PoolClient,
    tradeId: string,
    input: {
      place: string | null;
      mapLink: string | null;
      meetingAt: string;
      timeZone: string;
    },
    id?: string,
  ) {
    const values = [
      input.place,
      input.mapLink,
      input.meetingAt,
      input.timeZone,
    ];
    const result = id
      ? await client.query<{ id: string }>(
          `UPDATE public.meetups SET place=$1,map_link=$2,meeting_at=$3,time_zone=$4,revision=revision+1 WHERE id=$5 RETURNING id`,
          [...values, id],
        )
      : await client.query<{ id: string }>(
          `INSERT INTO public.meetups (place,map_link,meeting_at,time_zone,trade_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [...values, tradeId],
        );
    return result.rows[0]!.id;
  }

  async respond(
    client: PoolClient,
    id: string,
    actor: string,
    revision: number,
    tradeVersion: number,
    response: MeetingResponse['response'],
  ) {
    await client.query(
      `INSERT INTO public.meetup_responses (meetup_id,user_id,revision,trade_version,response) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (meetup_id,user_id,revision,trade_version) DO UPDATE SET response=EXCLUDED.response`,
      [id, actor, revision, tradeVersion, response],
    );
  }
}
