// Disposable database cloned from the local stack's schema only. No source data
// or production connection strings are read, copied, migrated, or removed.
import assert from 'node:assert/strict';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

assert.notEqual(process.env.NODE_ENV, 'production');

const container = 'supabase_db_swapcircle-local';
const database = `swapcircle_pair_test_${randomUUID().replaceAll('-', '')}`;
const docker = (args: string[], input?: string) =>
  execFileSync(
    'docker',
    ['exec', ...(input ? ['-i'] : []), container, ...args],
    {
      encoding: 'utf8',
      input,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
const sql = (input: string) =>
  docker(
    [
      'psql',
      '-X',
      '-U',
      'supabase_admin',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ],
    input,
  );
const migration = readFileSync(
  new URL('../migrations/0027_lazy_ben_urich.sql', import.meta.url),
  'utf8',
);
const [alice, bob, carol, trade, version] = Array.from({ length: 5 }, () =>
  randomUUID(),
);

export async function testTwoPersonDatabase(
  verify?: (
    database: string,
    phase: 'before-migration' | 'after-migration',
  ) => Promise<void>,
) {
  try {
    docker(['createdb', '-U', 'supabase_admin', database]);
    sql(
      docker([
        'pg_dump',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '--schema-only',
      ]),
    );
    // Replay application history from scratch inside this disposable database.
    // The runtime role is cluster-wide and already exists in the source stack;
    // skip only its CREATE ROLE statement, preserving every schema migration.
    sql(`DROP SCHEMA public CASCADE;
    DROP SCHEMA private CASCADE;
    DROP SCHEMA drizzle CASCADE;
    CREATE SCHEMA public;
    DROP POLICY item_media_deny_browser_insert ON storage.objects;
    DROP POLICY item_media_deny_browser_update ON storage.objects;
    DROP POLICY item_media_deny_browser_delete ON storage.objects;`);
    const history = JSON.parse(
      readFileSync(
        new URL('../migrations/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as {
      entries: { tag: string }[];
    };
    for (const entry of history.entries.slice(0, -1)) {
      let source = readFileSync(
        new URL(`../migrations/${entry.tag}.sql`, import.meta.url),
        'utf8',
      );
      if (entry.tag.startsWith('0000_'))
        source = source.replace(/^CREATE ROLE swapcircle_runtime .*;$/m, '');
      sql(`BEGIN;\n${source}\nCOMMIT;`);
    }
    const [existingTrade, existingVersion] = [randomUUID(), randomUUID()];
    sql(`INSERT INTO auth.users(id) VALUES ('${alice}'),('${bob}'),('${carol}');
      INSERT INTO public.profiles(id,display_name) VALUES ('${alice}','Synthetic Alice'),('${bob}','Synthetic Bob'),('${carol}','Synthetic Carol');
      BEGIN;
      INSERT INTO public.trades(id,creator_id,expires_at) VALUES ('${existingTrade}','${alice}',now()+interval '1 day');
      INSERT INTO public.trade_participants(trade_id,user_id) VALUES ('${existingTrade}','${alice}'),('${existingTrade}','${bob}');
      INSERT INTO public.trade_versions(id,trade_id,version,created_by,participant_ids,expires_at)
        VALUES ('${existingVersion}','${existingTrade}',1,'${alice}',ARRAY['${alice}','${bob}']::uuid[],now()+interval '1 day');
      COMMIT;`);
    const savedTerms = sql(
      `SELECT row_to_json(v) FROM public.trade_versions v WHERE trade_id='${existingTrade}';`,
    );
    // Legacy data blocks removal before any DDL. No message/history is discarded.
    sql("INSERT INTO public.conversations(type) VALUES ('group');");
    assert.throws(() => sql(`BEGIN;\n${migration}\nCOMMIT;`));
    assert.equal(
      sql(
        "SELECT count(*) FROM public.conversations WHERE type='group';",
      ).trim(),
      '1',
    );
    assert.equal(
      sql(
        "SELECT to_regclass('public.conversation_membership_events') IS NOT NULL;",
      ).trim(),
      't',
    );
    sql("DELETE FROM public.conversations WHERE type='group';");
    await verify?.(database, 'before-migration');
    sql(`BEGIN;\n${migration}\nCOMMIT;`);
    assert.equal(
      sql(
        "SELECT to_regclass('public.conversation_membership_events') IS NULL AND to_regprocedure('private.respond_group_membership(uuid,uuid,text)') IS NULL AND to_regprocedure('private.reconcile_trade_group(uuid,uuid,uuid[])') IS NULL;",
      ).trim(),
      't',
    );
    assert.equal(
      sql(
        `SELECT row_to_json(v) FROM public.trade_versions v WHERE trade_id='${existingTrade}';`,
      ),
      savedTerms,
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM public.trade_participants WHERE trade_id='${existingTrade}';`,
      ).trim(),
      '2',
    );
    assert.throws(() =>
      sql("INSERT INTO public.conversations(type) VALUES ('group');"),
    );
    assert.throws(() =>
      sql(`BEGIN;
    INSERT INTO public.trades(id,creator_id,expires_at) VALUES ('${trade}','${alice}',now()+interval '1 day');
    INSERT INTO public.trade_participants(trade_id,user_id) VALUES ('${trade}','${alice}');
    COMMIT;`),
    );
    assert.equal(
      sql(`SELECT count(*) FROM public.trades WHERE id='${trade}';`).trim(),
      '0',
    );
    sql(`BEGIN;
    INSERT INTO public.trades(id,creator_id,expires_at) VALUES ('${trade}','${alice}',now()+interval '1 day');
    INSERT INTO public.trade_participants(trade_id,user_id) VALUES ('${trade}','${alice}'),('${trade}','${bob}');
    INSERT INTO public.trade_versions(id,trade_id,version,created_by,participant_ids,expires_at)
      VALUES ('${version}','${trade}',1,'${alice}',ARRAY['${alice}','${bob}']::uuid[],now()+interval '1 day');
    COMMIT;`);
    for (const statement of [
      `INSERT INTO public.trade_participants(trade_id,user_id) VALUES ('${trade}','${carol}')`,
      `UPDATE public.trade_participants SET user_id='${carol}' WHERE trade_id='${trade}' AND user_id='${bob}'`,
      `DELETE FROM public.trade_participants WHERE trade_id='${trade}' AND user_id='${bob}'`,
      `INSERT INTO public.trade_versions(trade_id,version,created_by,participant_ids,expires_at) VALUES ('${trade}',2,'${alice}',ARRAY['${alice}','${bob}','${carol}']::uuid[],now()+interval '1 day')`,
      `INSERT INTO public.trade_versions(trade_id,version,created_by,participant_ids,expires_at) VALUES ('${trade}',2,'${alice}',ARRAY['${alice}','${carol}']::uuid[],now()+interval '1 day')`,
    ])
      assert.throws(() => sql(statement));
    sql(
      `INSERT INTO public.trade_versions(trade_id,version,created_by,participant_ids,expires_at) VALUES ('${trade}',2,'${alice}',ARRAY['${bob}','${alice}']::uuid[],now()+interval '1 day');`,
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM public.trade_participants WHERE trade_id='${trade}';`,
      ).trim(),
      '2',
    );
    await verify?.(database, 'after-migration');
    console.info(
      'Disposable local database: guarded migration, removed structures, two fixed participants and immutable version pair passed.',
    );
  } finally {
    docker(['dropdb', '-U', 'supabase_admin', '--if-exists', database]);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await testTwoPersonDatabase();
