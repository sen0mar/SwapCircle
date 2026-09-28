import type { PoolClient } from 'pg';

// Accept the service-owned transaction; these operations never commit separately.
export class SafetyChecksRepository {
  async restricted(client: PoolClient, actors: string[]) {
    return Boolean(
      (
        await client.query(
          'SELECT 1 FROM public.account_restrictions WHERE user_id = ANY($1::uuid[])',
          [actors],
        )
      ).rowCount,
    );
  }

  async blocked(client: PoolClient, actor: string, other: string) {
    return Boolean(
      (
        await client.query(
          `SELECT 1 FROM public.blocks WHERE
       (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
          [actor, other],
        )
      ).rowCount,
    );
  }

  async lockAccount(client: PoolClient, user: string) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`safety:${user}`],
    );
  }

  async provision(client: PoolClient, actor: string) {
    await client.query(
      "INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Member') ON CONFLICT DO NOTHING",
      [actor],
    );
  }

  async consume(
    client: PoolClient,
    actor: string,
    action: string,
    windowSeconds: number,
    allowance: number,
  ) {
    // The database clock and unique row serialize concurrent consumers. A rejected
    // domain write rolls back its charge with the caller's transaction.
    return Boolean(
      (
        await client.query(
          `INSERT INTO public.action_quotas (user_id, action, window_started_at, used)
       VALUES ($1, $2, statement_timestamp(), 1)
       ON CONFLICT (user_id, action) DO UPDATE SET
         used = CASE WHEN action_quotas.window_started_at + make_interval(secs => $3) <= statement_timestamp()
           THEN 1 ELSE action_quotas.used + 1 END,
         window_started_at = CASE WHEN action_quotas.window_started_at + make_interval(secs => $3) <= statement_timestamp()
           THEN statement_timestamp() ELSE action_quotas.window_started_at END
       WHERE action_quotas.used < $4 OR action_quotas.window_started_at + make_interval(secs => $3) <= statement_timestamp()
       RETURNING used`,
          [actor, action, windowSeconds, allowance],
        )
      ).rowCount,
    );
  }
}
