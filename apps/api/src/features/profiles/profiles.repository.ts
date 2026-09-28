import { SafetyPermissions } from '../safety/safety.permissions.js';
import type { Pool, PoolClient } from 'pg';
import type {
  CurrentProfile,
  MemberQuery,
  MemberCursor,
  DiscoveredMember,
  ProfileUpdate,
  PublicProfile,
} from '@swapcircle/contracts';

type ProfileRow = {
  id: string;
  display_name: string;
  biography: string;
  approximate_location: string;
  avatar_storage_key: string | null;
  avatar_cleanup_pending: boolean;
  created_at: Date;
  updated_at: Date;
};

type InterestRow = { id: string; name: string };

export class UnknownInterestError extends Error {}
export class RestrictedAccountError extends Error {}
export class AvatarChangedError extends Error {}

export class ProfilesRepository {
  constructor(
    private readonly pool: Pool,
    readonly permissions = new SafetyPermissions(),
  ) {}

  async provision(userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Member') ON CONFLICT (id) DO NOTHING`,
      [userId],
    );
  }

  async interests(): Promise<InterestRow[]> {
    const result = await this.pool.query<InterestRow>(
      'SELECT id, name FROM public.interests ORDER BY name',
    );

    return result.rows;
  }

  async profile(
    userId: string,
  ): Promise<(CurrentProfile & { avatarStorageKey: string | null }) | null> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT id, display_name, biography, approximate_location, avatar_storage_key, created_at, updated_at,
       EXISTS (SELECT 1 FROM public.avatar_cleanup WHERE owner_id=$1) AS avatar_cleanup_pending
       FROM public.profiles WHERE id = $1`,
      [userId],
    );

    const row = result.rows[0];

    if (!row) return null;

    return {
      id: row.id,
      displayName: row.display_name,
      biography: row.biography,
      approximateLocation: row.approximate_location,
      avatarUrl: null,
      avatarStorageKey: row.avatar_storage_key,
      avatarCleanupPending: row.avatar_cleanup_pending,
      interests: await this.profileInterests(this.pool, userId),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async publicProfile(
    userId: string,
  ): Promise<(PublicProfile & { avatarStorageKey: string | null }) | null> {
    const profile = await this.profile(userId);

    if (!profile) return null;

    const {
      id,
      displayName,
      biography,
      approximateLocation,
      interests,
      avatarStorageKey,
    } = profile;

    return {
      id,
      displayName,
      biography,
      approximateLocation,
      interests,
      avatarUrl: null,
      avatarStorageKey,
    };
  }

  async discover(query: MemberQuery, actor?: string, cursor?: MemberCursor) {
    const result = await this.pool.query<
      DiscoveredMember & { avatarStorageKey: string | null }
    >(
      `WITH members AS (
        SELECT p.id, p.display_name AS "displayName", p.biography,
          p.approximate_location AS "approximateLocation", p.avatar_storage_key AS "avatarStorageKey",
          NULL::text AS "avatarUrl",
          COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) ORDER BY i.name)
            FILTER (WHERE i.id IS NOT NULL), '[]') AS interests,
          COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) ORDER BY i.name)
            FILTER (WHERE mine.interest_id IS NOT NULL), '[]') AS "sharedInterests",
          CASE WHEN $1::uuid IS NULL THEN NULL ELSE count(mine.interest_id)::int END AS "sharedInterestCount"
        FROM public.profiles p
        LEFT JOIN public.profile_interests pi ON pi.profile_id = p.id
        LEFT JOIN public.interests i ON i.id = pi.interest_id
        LEFT JOIN public.profile_interests mine ON mine.profile_id = $1 AND mine.interest_id = pi.interest_id
        WHERE ($1::uuid IS NULL OR p.id <> $1)
          AND ($2::uuid IS NULL OR EXISTS (
            SELECT 1 FROM public.profile_interests filter WHERE filter.profile_id = p.id AND filter.interest_id = $2))
        GROUP BY p.id
      ) SELECT * FROM members
      WHERE ($3::uuid IS NULL OR (COALESCE("sharedInterestCount", 0), id) < ($4::int, $3::uuid))
      ORDER BY COALESCE("sharedInterestCount", 0) DESC, id DESC LIMIT $5`,
      [
        actor ?? null,
        query.interest ?? null,
        cursor?.id ?? null,
        cursor?.sharedInterestCount ?? 0,
        query.limit + 1,
      ],
    );

    return result.rows;
  }

  async avatarKey(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ avatar_storage_key: string | null }>(
      'SELECT avatar_storage_key FROM public.profiles WHERE id=$1',
      [userId],
    );
    return result.rows[0]?.avatar_storage_key ?? null;
  }

  async swapAvatar(
    userId: string,
    expected: string | null,
    key: string | null,
    charge = true,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM public.profiles WHERE id=$1 FOR UPDATE',
        [userId],
      );
      await this.permissions.assertUnrestricted(client, [userId]);
      const previous = await client.query<{
        avatar_storage_key: string | null;
      }>('SELECT avatar_storage_key FROM public.profiles WHERE id=$1', [
        userId,
      ]);
      if (!previous.rowCount) throw new Error('Profile not found.');
      if (previous.rows[0]?.avatar_storage_key !== expected)
        throw new AvatarChangedError();
      const pendingCleanup = await client.query(
        'SELECT 1 FROM public.avatar_cleanup WHERE owner_id=$1 LIMIT 1',
        [userId],
      );
      if (charge && (key !== expected || pendingCleanup.rowCount))
        await this.permissions.consume(client, userId, 'avatar');

      await client.query(
        'UPDATE public.profiles SET avatar_storage_key=$2, updated_at=now() WHERE id=$1',
        [userId, key],
      );
      if (expected)
        await client.query(
          'INSERT INTO public.avatar_cleanup (storage_key, owner_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [expected, userId],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Charge a durable processing/storage attempt before external work. Failure does
  // not refund it: repeated invalid uploads must not bypass the processing bound.
  // No transaction stays open during decoding or a Storage request.
  async authorizeAvatarUpload(userId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.permissions.authorizeWrite(client, userId, 'avatar');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async checkAvatarCleanup(userId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.permissions.assertUnrestricted(client, [userId]);
      const pending = await client.query(
        'SELECT 1 FROM public.avatar_cleanup WHERE owner_id=$1 LIMIT 1',
        [userId],
      );
      if (pending.rowCount)
        await this.permissions.consume(client, userId, 'avatar');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async queueAvatarCleanup(userId: string, key: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO public.avatar_cleanup (storage_key, owner_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [key, userId],
    );
  }

  async pendingAvatarCleanup(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ storage_key: string }>(
      'SELECT storage_key FROM public.avatar_cleanup WHERE owner_id=$1 ORDER BY created_at',
      [userId],
    );
    return result.rows.map((row) => row.storage_key);
  }

  async finishAvatarCleanup(userId: string, key: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM public.avatar_cleanup WHERE owner_id=$1 AND storage_key=$2',
      [userId, key],
    );
  }

  async update(
    userId: string,
    input: ProfileUpdate,
  ): Promise<CurrentProfile & { avatarStorageKey: string | null }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.profiles (id, display_name) VALUES ($1, 'Member') ON CONFLICT (id) DO NOTHING`,
        [userId],
      );

      await client.query(
        'SELECT id FROM public.profiles WHERE id = $1 FOR UPDATE',
        [userId],
      );

      await this.permissions.authorizeWrite(client, userId, 'profile');

      const known = await client.query<{ id: string }>(
        'SELECT id FROM public.interests WHERE id = ANY($1::uuid[])',
        [input.interestIds],
      );

      if (known.rows.length !== input.interestIds.length)
        throw new UnknownInterestError();

      await client.query(
        `UPDATE public.profiles SET display_name = $2, biography = $3,
         approximate_location = $4, updated_at = now() WHERE id = $1`,
        [userId, input.displayName, input.biography, input.approximateLocation],
      );

      await client.query(
        'DELETE FROM public.profile_interests WHERE profile_id = $1',
        [userId],
      );

      if (input.interestIds.length)
        await client.query(
          `INSERT INTO public.profile_interests (profile_id, interest_id)
           SELECT $1, unnest($2::uuid[])`,
          [userId, input.interestIds],
        );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const profile = await this.profile(userId);

    if (!profile) throw new Error('Updated profile was not found.');

    return profile;
  }

  private async profileInterests(
    client: Pool | PoolClient,
    userId: string,
  ): Promise<InterestRow[]> {
    const result = await client.query<InterestRow>(
      `SELECT i.id, i.name FROM public.interests i
       JOIN public.profile_interests pi ON pi.interest_id = i.id
       WHERE pi.profile_id = $1 ORDER BY i.name`,
      [userId],
    );

    return result.rows;
  }
}
