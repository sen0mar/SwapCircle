import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { Pool } from 'pg';
import {
  databaseConfig,
  assertLocalTarget,
  assertLocalRuntimeTarget,
} from '@swapcircle/database';
import { PhotosRepository } from '../dist/features/photos/photos.repository.js';
import { PhotosService } from '../dist/features/photos/photos.service.js';
import { createPhotoStorage } from '../dist/features/photos/photos.storage.js';

async function main() {
  assert.equal(process.argv.length, 2);
  assert.equal(process.env.CLEANUP_LOCAL_SYNTHETIC, '1');
  assertLocalTarget(process.env.MIGRATION_DATABASE_URL, process.env.NODE_ENV);
  assertLocalRuntimeTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  const status = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(status.API_URL, 'http://127.0.0.1:55431');
  const runtime = new Pool(databaseConfig(process.env.DATABASE_URL));
  const storage = createPhotoStorage(status.API_URL, status.SERVICE_ROLE_KEY);
  const photos = new PhotosService(new PhotosRepository(runtime), storage);
  try {
    const listings = (
      await runtime.query(`SELECT p.listing_id, p.owner_id FROM public.listing_photos p
      WHERE (p.state='deleting' OR (p.state='pending' AND p.created_at < now() - interval '10 minutes'))
      AND NOT EXISTS (SELECT 1 FROM public.trade_items i WHERE i.listing_id=p.listing_id)
      GROUP BY listing_id, owner_id ORDER BY listing_id LIMIT 16`)
    ).rows;
    // At most 16 listings × three slots plus 48 queued avatars per invocation.
    // Do not scan/delete arbitrary unreferenced objects: an avatar may be uploading.
    for (const row of listings)
      await photos.cleanup(row.owner_id, row.listing_id);
    const avatars = (
      await runtime.query(`SELECT storage_key, owner_id FROM public.avatar_cleanup
      WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE avatar_storage_key=storage_key)
      ORDER BY created_at, storage_key LIMIT 48`)
    ).rows;
    for (const row of avatars) {
      // Keys are fresh random immutable identifiers; application uploads never reuse
      // a queued key. On failure the durable handle stays available for retry.
      await storage.remove(row.storage_key);
      await runtime.query(
        'DELETE FROM public.avatar_cleanup WHERE owner_id=$1 AND storage_key=$2',
        [row.owner_id, row.storage_key],
      );
    }
    console.log('Bounded isolated image cleanup completed.');
  } finally {
    await runtime.end();
  }
}

main().catch(() => {
  console.error(
    'Isolated cleanup failed; durable handles remain retryable. No private data was logged.',
  );
  process.exitCode = 1;
});
