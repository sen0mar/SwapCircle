import type { Pool } from 'pg';
import { SafetyPermissions } from '../../dist/features/safety/safety.permissions.js';
import type {
  MediaReplacement,
  MediaRefreshRepository,
} from './media-refresh.service.ts';

export class DemoMediaRepository implements MediaRefreshRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async assertOwned(media: MediaReplacement) {
    const client = await this.pool.connect();
    try {
      await new SafetyPermissions().assertUnrestricted(client, [media.ownerId]);
    } finally {
      client.release();
    }

    const result = media.photoId
      ? await this.pool.query(
          `SELECT 1 FROM public.listing_photos p
           JOIN public.listings l ON l.id=p.listing_id
           WHERE p.id=$1 AND p.owner_id=$2 AND l.owner_id=$2
             AND p.storage_key=$3 AND p.state='active'`,
          [media.photoId, media.ownerId, media.storageKey],
        )
      : await this.pool.query(
          'SELECT 1 FROM public.profiles WHERE id=$1 AND avatar_storage_key=$2',
          [media.ownerId, media.storageKey],
        );

    if (result.rowCount !== 1) throw new Error('Demo media record changed.');
  }

  async inventory(photoIds: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const role = (await client.query('select current_user')).rows[0]
        .current_user;
      if (role !== 'swapcircle_runtime')
        throw new Error('Unexpected media maintenance role.');
      const tables = (
        await client.query<{ name: string; rls: boolean }>(
          `select c.relname name, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not exists (select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') order by c.relname`,
        )
      ).rows;
      const inventory = [];
      for (const table of tables) {
        if (!table.rls || !/^[a-z_]+$/.test(table.name))
          throw new Error('Unexpected public table.');
        // Only the byte counts of the exact planned photo IDs may change.
        const value =
          table.name === 'listing_photos'
            ? "CASE WHEN t.id=ANY($1::uuid[]) THEN to_jsonb(t)-'bytes' ELSE to_jsonb(t) END"
            : 'to_jsonb(t)';
        const result = await client.query<{ hash: string }>(
          `SELECT md5((${value})::text) hash FROM public."${table.name}" t ORDER BY hash`,
          table.name === 'listing_photos' ? [photoIds] : [],
        );
        inventory.push({
          table: table.name,
          hashes: result.rows.map((row) => row.hash),
        });
      }
      await client.query('ROLLBACK');
      return inventory;
    } finally {
      client.release();
    }
  }

  async recordBytes(media: MediaReplacement) {
    if (!media.photoId) return;

    const result = await this.pool.query(
      `UPDATE public.listing_photos SET bytes=$4
       WHERE id=$1 AND owner_id=$2 AND storage_key=$3 AND state='active'
         AND EXISTS (SELECT 1 FROM public.listings l
           WHERE l.id=listing_photos.listing_id AND l.owner_id=$2)`,
      [media.photoId, media.ownerId, media.storageKey, media.body.length],
    );

    if (result.rowCount !== 1)
      throw new Error('Demo media record changed during refresh.');
  }
}
