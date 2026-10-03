import assert from 'node:assert/strict';
import type { Pool } from 'pg';

const runtimeRules: Record<string, [string, string[]]> = {
  account_restrictions: ['runtime_account_restrictions', ['SELECT']],
  action_quotas: ['runtime_action_quotas', ['SELECT', 'INSERT', 'UPDATE']],
  avatar_cleanup: ['runtime_avatar_cleanup', ['SELECT', 'INSERT', 'DELETE']],
  blocks: ['runtime_blocks', ['SELECT', 'INSERT', 'DELETE']],
  coffee_invitations: ['runtime_coffee', ['SELECT', 'INSERT', 'UPDATE']],
  conversation_members: ['runtime_memberships', ['SELECT', 'INSERT']],
  conversation_membership_events: [
    'runtime_membership_events',
    ['SELECT', 'INSERT'],
  ],
  conversation_reads: ['runtime_read_progress', ['SELECT', 'INSERT', 'UPDATE']],
  conversations: ['runtime_conversations', ['SELECT', 'INSERT']],
  interests: ['runtime_interests', ['SELECT']],
  item_reservations: ['runtime_reservations', ['SELECT', 'INSERT']],
  listing_photos: [
    'runtime_listing_photos',
    ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  ],
  listings: ['runtime_listings', ['SELECT', 'INSERT', 'UPDATE']],
  meetup_operations: ['runtime_meetup_operations', ['SELECT', 'INSERT']],
  meetup_responses: [
    'runtime_meetup_responses',
    ['SELECT', 'INSERT', 'UPDATE'],
  ],
  meetups: ['runtime_meetups', ['SELECT', 'INSERT', 'UPDATE']],
  messages: ['runtime_messages', ['SELECT', 'INSERT']],
  notifications: ['runtime_notifications', ['SELECT', 'INSERT']],
  profile_interests: [
    'runtime_profile_interests',
    ['SELECT', 'INSERT', 'DELETE'],
  ],
  profiles: ['runtime_profiles', ['SELECT', 'INSERT', 'UPDATE']],
  reports: ['runtime_reports', ['SELECT', 'INSERT']],
  trade_acceptance_operations: [
    'runtime_acceptance_operations',
    ['SELECT', 'INSERT'],
  ],
  trade_acceptances: ['runtime_trade_acceptances', ['SELECT', 'INSERT']],
  trade_events: ['runtime_trade_events', ['SELECT', 'INSERT']],
  trade_items: ['runtime_trade_items', ['SELECT', 'INSERT']],
  trade_outcome_operations: [
    'runtime_trade_outcome_operations',
    ['SELECT', 'INSERT'],
  ],
  trade_participants: [
    'runtime_trade_participants',
    ['SELECT', 'INSERT', 'UPDATE'],
  ],
  trade_versions: ['runtime_trade_versions', ['SELECT', 'INSERT']],
  trades: ['runtime_trades', ['SELECT', 'INSERT', 'UPDATE']],
};

const readerPolicies = [
  [
    'conversation_members',
    'member_memberships',
    '(active AND private.can_read_conversation(conversation_id))',
  ],
  [
    'conversation_members',
    'own_membership_status',
    '(user_id = ( SELECT auth.uid() AS uid))',
  ],
  [
    'conversation_reads',
    'own_read_progress',
    '((user_id = ( SELECT auth.uid() AS uid)) AND private.can_read_conversation(conversation_id))',
  ],
  [
    'conversations',
    'member_conversations',
    'private.can_read_conversation(id)',
  ],
  [
    'messages',
    'member_messages',
    'private.can_read_conversation(conversation_id)',
  ],
  [
    'notifications',
    'recipient_notifications',
    '((recipient_id = ( SELECT auth.uid() AS uid)) AND ( SELECT private.can_read_notifications() AS can_read_notifications))',
  ],
];

export async function verifyPermissions(pool: Pool) {
  const expectedPolicies = Object.entries(runtimeRules).map(
    ([table, [policy, grants]]) => ({
      tablename: table,
      policyname: policy,
      permissive: 'PERMISSIVE',
      roles: '{swapcircle_runtime}',
      cmd: 'ALL',
      qual: 'true',
      with_check: grants.length === 1 ? null : 'true',
    }),
  );
  expectedPolicies.push(
    ...readerPolicies.map(([table, policy, qual]) => ({
      tablename: table!,
      policyname: policy!,
      permissive: 'PERMISSIVE',
      roles: '{authenticated}',
      cmd: 'SELECT',
      qual: qual!,
      with_check: null,
    })),
  );
  const policies = await pool.query(
    "select tablename,policyname,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname",
  );

  assert.deepEqual(
    policies.rows,
    expectedPolicies.sort(
      (a, b) =>
        a.tablename.localeCompare(b.tablename) ||
        a.policyname.localeCompare(b.policyname),
    ),
  );
  const tablePrivileges = await pool.query<{
    table_name: string;
    privilege: string;
    allowed: boolean;
  }>(`
    select c.relname as table_name, p.privilege,
      has_table_privilege('swapcircle_runtime', c.oid, p.privilege) as allowed
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(privilege)
    where n.nspname='public' and c.relkind in ('r','p')`);

  for (const row of tablePrivileges.rows) {
    assert.ok(runtimeRules[row.table_name], 'Unexpected application table.');
    assert.equal(
      row.allowed,
      runtimeRules[row.table_name]![1].includes(row.privilege),
      `${row.table_name} runtime ${row.privilege}`,
    );
  }

  const columnPrivileges = await pool.query<{
    table_name: string;
    column_name: string;
    role: string;
    privilege: string;
    allowed: boolean;
  }>(`
    select c.table_name,c.column_name,r.role,p.privilege,
      has_column_privilege(r.role, format('%I.%I',c.table_schema,c.table_name), c.column_name,p.privilege) as allowed
    from information_schema.columns c
    cross join unnest(ARRAY['anon','authenticated','service_role','swapcircle_runtime']) as r(role)
    cross join unnest(ARRAY['INSERT','UPDATE','REFERENCES']) as p(privilege)
    where c.table_schema='public'`);

  for (const row of columnPrivileges.rows) {
    const grants = runtimeRules[row.table_name]![1];
    const extraUpdate =
      row.privilege === 'UPDATE' &&
      (
        {
          conversations: 'last_message_order',
          notifications: 'read_at',
          item_reservations: 'released_at',
        } as Record<string, string>
      )[row.table_name] === row.column_name;
    assert.equal(
      row.allowed,
      row.role === 'swapcircle_runtime' &&
        (grants.includes(row.privilege) || extraUpdate),
      `${row.role} ${row.table_name}.${row.column_name} ${row.privilege}`,
    );
  }

  const storage = await pool.query(
    "select policyname,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname",
  );
  assert.deepEqual(storage.rows, [
    {
      policyname: 'item_media_deny_browser_delete',
      permissive: 'RESTRICTIVE',
      roles: '{anon,authenticated}',
      cmd: 'DELETE',
      qual: "(bucket_id <> 'item-media'::text)",
      with_check: null,
    },
    {
      policyname: 'item_media_deny_browser_insert',
      permissive: 'RESTRICTIVE',
      roles: '{anon,authenticated}',
      cmd: 'INSERT',
      qual: null,
      with_check: "(bucket_id <> 'item-media'::text)",
    },
    {
      policyname: 'item_media_deny_browser_update',
      permissive: 'RESTRICTIVE',
      roles: '{anon,authenticated}',
      cmd: 'UPDATE',
      qual: "(bucket_id <> 'item-media'::text)",
      with_check: "(bucket_id <> 'item-media'::text)",
    },
  ]);
  assert.deepEqual(
    (
      await pool.query(
        'select id,name,public,file_size_limit::int,allowed_mime_types from storage.buckets order by id',
      )
    ).rows,
    [
      {
        id: 'item-media',
        name: 'item-media',
        public: true,
        file_size_limit: 2097152,
        allowed_mime_types: ['image/webp'],
      },
    ],
  );

  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: '00000000-0000-4000-8000-000000000049',
        role: 'authenticated',
      }),
    ]);
    await client.query('set local role authenticated');
    for (const table of [
      'conversations',
      'conversation_members',
      'conversation_reads',
      'messages',
      'notifications',
    ]) {
      assert.equal(
        (await client.query(`select 1 from public.${table} limit 1`)).rowCount,
        0,
      );
    }
    await assert.rejects(
      client.query(
        "select private.can_read_conversation('00000000-0000-4000-8000-000000000049')",
      ),
      { code: '42501' },
    );
  } finally {
    await client.query('rollback');
    client.release();
  }
}
