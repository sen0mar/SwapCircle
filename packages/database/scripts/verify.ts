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
      1,
    );

    console.log(
      'Verified migration replay, runtime login/DDL denial, default table/function denial, and RLS isolation.',
    );
  } finally {
    await runtime.end();
  }
}
