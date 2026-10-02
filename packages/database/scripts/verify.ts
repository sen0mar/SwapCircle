import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { databaseConfig } from '../src/config.ts';

export async function verify(pool: Pool, runtimeUrl: string) {
  const runtime = new Pool(databaseConfig(runtimeUrl));

  try {
    const role = await runtime.query('select current_user');

    assert.equal(role.rows[0].current_user, 'swapcircle_runtime');

    await assert.rejects(
      runtime.query('create table public.forbidden_probe (id int)'),
      { code: '42501' },
    );

    const client = await pool.connect();

    try {
      await client.query('begin');
      await client.query('create table public.permission_probe (id int)');

      await client.query(
        'alter table public.permission_probe enable row level security',
      );

      await client.query('insert into public.permission_probe values (1)');

      await client.query(
        'create function public.permission_probe_fn() returns int language sql as $$ select 1 $$',
      );

      for (const role of [
        'anon',
        'authenticated',
        'service_role',
        'swapcircle_runtime',
      ]) {
        const access = await client.query(
          `select
          has_table_privilege($1, 'public.permission_probe', 'SELECT') as read,
          has_table_privilege($1, 'public.permission_probe', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as write,
          has_function_privilege($1, 'public.permission_probe_fn()', 'EXECUTE') as execute`,
          [role],
        );

        assert.deepEqual(access.rows[0], {
          read: false,
          write: false,
          execute: false,
        });
      }

      // Even an explicit read grant does not make rows visible without an RLS policy.
      await client.query(
        'grant select on public.permission_probe to authenticated',
      );

      await client.query('set local role authenticated');

      assert.equal(
        (await client.query('select * from public.permission_probe')).rowCount,
        0,
      );

      await client.query('reset role');
    } finally {
      await client.query('rollback');
      client.release();
    }

    const roles = await pool.query(
      "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit from pg_roles where rolname = 'swapcircle_runtime'",
    );

    assert.deepEqual(roles.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      rolinherit: false,
    });

    assert.equal(
      (await pool.query('select * from drizzle.__drizzle_migrations')).rowCount,
      24,
    );

    const publication = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY tablename",
    );
    assert.deepEqual(
      publication.rows.map((row) => row.tablename),
      [
        'conversation_members',
        'conversation_reads',
        'conversations',
        'messages',
        'notifications',
      ],
    );

    for (const table of [
      'meetups',
      'meetup_responses',
      'meetup_operations',
      'coffee_invitations',
      'profiles',
      'interests',
      'profile_interests',
      'account_restrictions',
      'listings',
      'listing_photos',
      'avatar_cleanup',
      'blocks',
      'reports',
      'action_quotas',
      'conversations',
      'conversation_members',
      'conversation_membership_events',
      'conversation_reads',
      'messages',
      'notifications',
      'trades',
      'trade_versions',
      'trade_participants',
      'trade_items',
      'trade_events',
      'trade_acceptances',
      'trade_acceptance_operations',
      'trade_outcome_operations',
      'item_reservations',
    ]) {
      const protection = await pool.query<{ relrowsecurity: boolean }>(
        'select relrowsecurity from pg_class where oid = $1::regclass',
        [`public.${table}`],
      );

      assert.equal(protection.rows[0]?.relrowsecurity, true);

      for (const role of ['anon', 'authenticated', 'service_role']) {
        const access = await pool.query<{ read: boolean; write: boolean }>(
          `select has_table_privilege($1, $2, 'SELECT') as read,
                  has_table_privilege($1, $2, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as write`,
          [role, `public.${table}`],
        );

        assert.deepEqual(access.rows[0], {
          read:
            role === 'authenticated' &&
            [
              'conversations',
              'conversation_members',
              'conversation_reads',
              'messages',
              'notifications',
            ].includes(table),
          write: false,
        });
      }
    }

    for (const signature of [
      'public.allocate_message_order()',
      'public.guard_direct_membership()',
      'public.guard_conversation_identity()',
      'public.guard_trade_event_history()',
      'public.guard_proposal_terms()',
      'public.guard_new_trade_snapshot()',
      'private.guard_trade_handover()',
      'private.guard_exchanged_listing()',
    ]) {
      for (const role of [
        'anon',
        'authenticated',
        'service_role',
        'swapcircle_runtime',
      ]) {
        const access = await pool.query<{ execute: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') AS execute",
          [role, signature],
        );

        assert.equal(access.rows[0]?.execute, false);
      }
    }

    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(
        (
          await pool.query(
            "SELECT has_function_privilege($1, 'private.respond_group_membership(uuid,uuid,text)', 'EXECUTE') AS execute",
            [role],
          )
        ).rows[0]?.execute,
        false,
      );

      const result = await pool.query<{ execute: boolean }>(
        "SELECT has_function_privilege($1, 'private.lock_conversation_reader(uuid,uuid)', 'EXECUTE') AS execute",
        [role],
      );
      assert.equal(result.rows[0]?.execute, false);
    }

    for (const role of ['anon', 'service_role', 'swapcircle_runtime']) {
      const result = await pool.query<{ execute: boolean }>(
        "SELECT has_function_privilege($1, 'private.can_read_notifications()', 'EXECUTE') AS execute",
        [role],
      );
      assert.equal(result.rows[0]?.execute, false);
    }

    const searchIndex = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='listings_search_idx'",
    );
    assert.match(
      searchIndex.rows[0]?.indexdef ?? '',
      /USING gin .*to_tsvector/,
    );

    const order = await pool.query<{ condeferrable: boolean }>(
      `SELECT condeferrable FROM pg_constraint
       WHERE conrelid='public.listing_photos'::regclass AND conname='listing_photos_position_unique'`,
    );
    assert.equal(order.rows[0]?.condeferrable, true);

    const avatarColumn = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='avatar_storage_key'`,
    );
    assert.equal(avatarColumn.rowCount, 1);

    const bucket = await pool.query<{
      public: boolean;
      allowed_mime_types: string[];
    }>(
      "SELECT public, allowed_mime_types FROM storage.buckets WHERE id='item-media'",
    );
    assert.deepEqual(bucket.rows[0], {
      public: true,
      allowed_mime_types: ['image/webp'],
    });

    console.log(
      'Verified migration replay, runtime login/DDL denial, default table/function denial, and RLS isolation.',
    );
  } finally {
    await runtime.end();
  }
}
