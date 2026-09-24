import type { Pool, PoolClient } from 'pg';
import type {
  CurrentProfile,
  ProfileUpdate,
  PublicProfile,
} from '@swapcircle/contracts';

type ProfileRow = {
  id: string;
  display_name: string;
  biography: string;
  approximate_location: string;
  avatar_storage_key: string | null;
  created_at: Date;
  updated_at: Date;
};

type InterestRow = { id: string; name: string };

export class UnknownInterestError extends Error {}
export class RestrictedAccountError extends Error {}
export class AvatarChangedError extends Error {}

export class ProfilesRepository {
  constructor(private readonly pool: Pool) {}

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
      `SELECT id, display_name, biography, approximate_location, avatar_storage_key, created_at, updated_at
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
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM public.profiles WHERE id=$1 FOR UPDATE',
        [userId],
      );
      const restricted = await client.query(
        'SELECT 1 FROM public.account_restrictions WHERE user_id=$1',
        [userId],
      );
      if (restricted.rowCount) throw new RestrictedAccountError();
      const previous = await client.query<{
        avatar_storage_key: string | null;
      }>('SELECT avatar_storage_key FROM public.profiles WHERE id=$1', [
        userId,
      ]);
      if (!previous.rowCount) throw new Error('Profile not found.');
      if (previous.rows[0]?.avatar_storage_key !== expected)
        throw new AvatarChangedError();
      await client.query(
        'UPDATE public.profiles SET avatar_storage_key=$2, updated_at=now() WHERE id=$1',
        [userId, key],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

      const restriction = await client.query(
        'SELECT 1 FROM public.account_restrictions WHERE user_id = $1',
        [userId],
      );

      if (restriction.rowCount) throw new RestrictedAccountError();

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
