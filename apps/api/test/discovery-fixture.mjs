import { NotificationsService } from '../dist/features/notifications/notifications.service.js';
import { TradesService } from '../dist/features/trades/trades.service.js';
import { TradesRepository } from '../dist/features/trades/trades.repository.js';
import { NotificationsRepository } from '../dist/features/notifications/notifications.repository.js';
import { ConversationsService } from '../dist/features/conversations/conversations.service.js';
import { ConversationsRepository } from '../dist/features/conversations/conversations.repository.js';
// Synthetic accounts only; this fixture refuses every target except the isolated local stack.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { databaseConfig } from '@swapcircle/database';
import { createApp } from '../dist/app.js';
import { createTokenVerifier } from '../dist/auth/verify.js';
import { ProfilesRepository } from '../dist/features/profiles/profiles.repository.js';
import { ProfilesService } from '../dist/features/profiles/profiles.service.js';
import { ListingsRepository } from '../dist/features/listings/listings.repository.js';
import { ListingsService } from '../dist/features/listings/listings.service.js';
import { PhotosRepository } from '../dist/features/photos/photos.repository.js';
import { PhotosService } from '../dist/features/photos/photos.service.js';
import {
  SafetyPermissions,
  developmentLimits,
} from '../dist/features/safety/safety.permissions.js';
import { SafetyRepository } from '../dist/features/safety/safety.repository.js';
import { SafetyService } from '../dist/features/safety/safety.service.js';
import { createPhotoStorage } from '../dist/features/photos/photos.storage.js';

export async function createDiscoveryFixture(origin = 'http://127.0.0.1:4196') {
  const status = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(status.API_URL, 'http://127.0.0.1:55431');
  assert.equal(process.env.NODE_ENV, 'development');
  for (const value of [
    process.env.DATABASE_URL,
    process.env.MIGRATION_DATABASE_URL,
  ]) {
    const target = new URL(value);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.port, '55432');
    assert.equal(target.pathname, '/postgres');
  }
  const runtime = new Pool(databaseConfig(process.env.DATABASE_URL));
  const migration = new Pool(
    databaseConfig(process.env.MIGRATION_DATABASE_URL, false),
  );
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const storage = createPhotoStorage(status.API_URL, status.SERVICE_ROLE_KEY);
  const makeApp = (limits = developmentLimits) => {
    const permissions = new SafetyPermissions(limits);
    return createApp({
      trades: new TradesService(new TradesRepository(runtime), permissions),
      notifications: new NotificationsService(
        new NotificationsRepository(runtime),
        permissions,
      ),
      conversations: new ConversationsService(
        new ConversationsRepository(runtime),
        permissions,
      ),
      allowedOrigins: [origin],
      limits,
      verifyToken: createTokenVerifier(status.API_URL, status.ANON_KEY),
      safety: new SafetyService(new SafetyRepository(runtime), permissions),
      profiles: new ProfilesService(
        new ProfilesRepository(runtime, permissions),
        storage,
      ),
      listings: new ListingsService(
        new ListingsRepository(runtime, permissions),
      ),
      photos: new PhotosService(
        new PhotosRepository(runtime, permissions),
        storage,
      ),
    });
  };
  const app = makeApp();
  const users = [];
  const cleanup = async () => {
    const tradeIds = await migration.query(
      'SELECT DISTINCT trade_id FROM public.trade_participants WHERE user_id=ANY($1::uuid[])',
      [users.map((user) => user.id)],
    );
    if (tradeIds.rows.length > 0) {
      const client = await migration.connect();
      try {
        await client.query('BEGIN');
        // Privileged synthetic fixture cleanup only; production event history is immutable.
        await client.query(
          'ALTER TABLE public.trade_events DISABLE TRIGGER trade_events_append_only',
        );
        for (const { trade_id } of tradeIds.rows) {
          await client.query(
            'DELETE FROM public.trade_events WHERE trade_id=$1',
            [trade_id],
          );
          await client.query(
            'DELETE FROM public.trade_items WHERE trade_id=$1',
            [trade_id],
          );
          await client.query(
            'DELETE FROM public.trade_versions WHERE trade_id=$1',
            [trade_id],
          );
          await client.query(
            'DELETE FROM public.trade_participants WHERE trade_id=$1',
            [trade_id],
          );
          await client.query('DELETE FROM public.trades WHERE id=$1', [
            trade_id,
          ]);
        }
        await client.query(
          'ALTER TABLE public.trade_events ENABLE TRIGGER trade_events_append_only',
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    await migration.query(
      `DELETE FROM public.conversations WHERE id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id=ANY($1::uuid[]))`,
      [users.map((user) => user.id)],
    );
    await migration.query(
      'DELETE FROM public.reports WHERE reporter_id=ANY($1::uuid[]) OR reported_user_id=ANY($1::uuid[]) OR listing_id IN (SELECT id FROM public.listings WHERE owner_id=ANY($1::uuid[]))',
      [users.map((user) => user.id)],
    );
    for (const user of users) {
      const photos = await migration.query(
        'SELECT storage_key FROM public.listing_photos WHERE owner_id=$1',
        [user.id],
      );
      for (const row of photos.rows) await storage.remove(row.storage_key);
      await migration.query(
        'DELETE FROM public.listing_photos WHERE owner_id=$1',
        [user.id],
      );
      await migration.query('DELETE FROM public.listings WHERE owner_id=$1', [
        user.id,
      ]);
      await migration.query(
        'DELETE FROM public.account_restrictions WHERE user_id=$1',
        [user.id],
      );
      assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
    }
    await runtime.end();
    await migration.end();
  };
  try {
    for (let i = 0; i < 4; i++) {
      const email = `discovery-check-${randomUUID()}@example.invalid`;
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      assert.equal(created.error, null);
      const record = { id: created.data.user.id };
      users.push(record);
      const link = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      assert.equal(link.error, null);
      const client = createClient(status.API_URL, status.ANON_KEY, options);
      const login = await client.auth.verifyOtp({
        type: 'magiclink',
        token_hash: link.data.properties.hashed_token,
      });
      assert.equal(login.error, null);
      Object.assign(record, {
        client,
        session: login.data.session,
        token: login.data.session.access_token,
      });
    }
    return {
      app,
      makeApp,
      runtime,
      users,
      migration,
      storage,
      cleanup,
      publicAuth: { url: status.API_URL, key: status.ANON_KEY },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
