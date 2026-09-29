// All seed accounts, conversations and messages are synthetic and scoped to the
// guarded local fixture; cleanup removes only conversations involving these IDs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import console from 'node:console';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { directConversationReceiptSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';
import { developmentLimits } from '../dist/features/safety/safety.permissions.js';

const fixture = await createDiscoveryFixture();
const {
  app,
  migration,
  runtime,
  users: [alice, bob, carol, dan],
} = fixture;
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const start = (user, other, instance = app) =>
  request(instance)
    .post('/api/v1/conversations/direct')
    .set(auth(user))
    .send({ userId: other.id });
const read = async (user, table, column, id) => {
  const result = await user.client.from(table).select('*').eq(column, id);
  assert.equal(result.error, null);
  return result.data;
};
const insertMessage = (
  client,
  conversation,
  sender,
  body = 'Synthetic private history',
  key = randomUUID(),
) =>
  client.query(
    'INSERT INTO public.messages (conversation_id,sender_id,body,client_message_id) VALUES ($1,$2,$3,$4) RETURNING id,message_order',
    [conversation, sender.id, body, key],
  );

try {
  for (const user of [alice, bob, carol])
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);

  await request(app)
    .post('/api/v1/conversations/direct')
    .send({ userId: bob.id })
    .expect(401);
  await request(app)
    .post('/api/v1/conversations/direct')
    .set('Authorization', 'Bearer forged')
    .send({ userId: bob.id })
    .expect(401);
  await start(alice, alice).expect(400);
  await start(alice, { id: randomUUID() }).expect(404);
  await request(app)
    .post('/api/v1/conversations/direct')
    .set(auth(alice))
    .send({ userId: bob.id, actorId: carol.id })
    .expect(400);

  // Opposite-direction starts serialize on the same account locks, independent of
  // trades/interests, creating exactly one canonical pair and two active members.
  const raced = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      i % 2 ? start(bob, alice) : start(alice, bob),
    ),
  );
  assert.ok(raced.every((result) => result.status === 200));
  const direct = directConversationReceiptSchema.parse(raced[0].body);
  assert.ok(raced.every((result) => result.body.id === direct.id));
  assert.equal(
    (await start(alice, { id: bob.id.toUpperCase() }).expect(200)).body.id,
    direct.id,
  );
  assert.equal(
    (
      await migration.query('SELECT 1 FROM public.conversations WHERE id=$1', [
        direct.id,
      ])
    ).rowCount,
    1,
  );
  const members = await read(
    alice,
    'conversation_members',
    'conversation_id',
    direct.id,
  );
  assert.deepEqual(
    new Set(members.map((row) => row.user_id)),
    new Set([alice.id, bob.id]),
  );
  const charged = await migration.query(
    "SELECT sum(used)::int AS used FROM public.action_quotas WHERE user_id=ANY($1::uuid[]) AND action='conversation'",
    [[alice.id, bob.id]],
  );
  assert.equal(charged.rows[0].used, 1);
  // An authenticated actor without a provisioned profile can also start a DM.
  const fresh = (await start(dan, carol).expect(200)).body;

  const first = (await insertMessage(runtime, direct.id, alice)).rows[0];
  const second = (
    await insertMessage(
      runtime,
      direct.id,
      bob,
      '<script>Synthetic plain text</script>',
    )
  ).rows[0];
  assert.equal(first.message_order, 1);
  assert.equal(second.message_order, 2);
  const group = (
    await migration.query(
      "INSERT INTO public.conversations (type) VALUES ('group') RETURNING id",
    )
  ).rows[0].id;
  await migration.query(
    'INSERT INTO public.conversation_members (conversation_id,user_id,active) VALUES ($1,$2,true),($1,$3,true),($1,$4,false)',
    [group, alice.id, carol.id, dan.id],
  );
  const groupMessage = (
    await insertMessage(runtime, group, carol, 'Synthetic group history')
  ).rows[0];

  for (const user of [alice, bob]) {
    assert.equal(
      (await read(user, 'conversations', 'id', direct.id)).length,
      1,
    );
    assert.equal(
      (await read(user, 'messages', 'conversation_id', direct.id)).length,
      2,
    );
    assert.equal((await read(user, 'messages', 'id', first.id)).length, 1);
    assert.equal(
      (await read(user, 'conversation_members', 'conversation_id', direct.id))
        .length,
      2,
    );
  }
  for (const user of [carol, dan]) {
    assert.deepEqual(await read(user, 'conversations', 'id', direct.id), []);
    assert.deepEqual(
      await read(user, 'messages', 'conversation_id', direct.id),
      [],
    );
    assert.deepEqual(await read(user, 'messages', 'id', first.id), []);
    assert.deepEqual(
      await read(user, 'conversation_members', 'conversation_id', direct.id),
      [],
    );
  }
  for (const user of [alice, carol]) {
    assert.equal((await read(user, 'conversations', 'id', group)).length, 1);
    const history = await read(user, 'messages', 'conversation_id', group);
    assert.deepEqual(
      history.map((row) => row.id),
      [groupMessage.id],
    );
    assert.equal(
      (await read(user, 'conversation_members', 'conversation_id', group))
        .length,
      2,
    );
  }
  for (const user of [bob, dan]) {
    assert.deepEqual(await read(user, 'conversations', 'id', group), []);
    assert.deepEqual(await read(user, 'messages', 'id', groupMessage.id), []);
    assert.deepEqual(
      (await read(user, 'conversation_members', 'conversation_id', group)).map(
        (row) => ({ user_id: row.user_id, active: row.active }),
      ),
      user === dan ? [{ user_id: dan.id, active: false }] : [],
    );
  }
  // Both membership revocation and current restrictions take effect on the next read.
  await migration.query(
    'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
    [direct.id, bob.id],
  );
  for (const [table, column, id] of [
    ['conversations', 'id', direct.id],
    ['messages', 'id', first.id],
  ])
    assert.deepEqual(await read(bob, table, column, id), []);
  assert.deepEqual(
    (await read(bob, 'conversation_members', 'conversation_id', direct.id)).map(
      (row) => ({ user_id: row.user_id, active: row.active }),
    ),
    [{ user_id: bob.id, active: false }],
  );
  await start(bob, alice).expect(403);
  await start(alice, bob).expect(403);
  await assert.rejects(insertMessage(runtime, direct.id, bob), {
    code: '23514',
  });
  await migration.query(
    'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1 AND user_id=$2',
    [direct.id, bob.id],
  );
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
    [bob.id, 'Synthetic restriction'],
  );
  await start(bob, alice).expect(403);
  await start(alice, bob).expect(403);
  assert.deepEqual(
    await read(bob, 'messages', 'conversation_id', direct.id),
    [],
  );
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [bob.id],
  );

  for (const [blocker, blocked] of [
    [alice, bob],
    [bob, alice],
  ]) {
    await request(app)
      .put('/api/v1/safety/blocks')
      .set(auth(blocker))
      .send({ userId: blocked.id })
      .expect(204);
    await start(alice, bob).expect(403);
    await start(bob, alice).expect(403);
    // Blocks prevent renewed contact; history and existing groups remain visible.
    assert.equal(
      (await read(alice, 'messages', 'conversation_id', direct.id)).length,
      2,
    );
    assert.equal(
      (await read(alice, 'messages', 'conversation_id', group)).length,
      1,
    );
    await request(app)
      .delete(`/api/v1/safety/blocks/${blocked.id}`)
      .set(auth(blocker))
      .expect(204);
  }
  // A racing block transaction is observed before DM creation/opening succeeds.
  const blocker = await runtime.connect();
  try {
    await blocker.query('BEGIN');
    for (const id of [alice.id, bob.id].sort())
      await blocker.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`safety:${id}`],
      );
    await blocker.query(
      'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
      [alice.id, bob.id],
    );
    let settled = false;
    const waiting = start(bob, alice).then((result) => {
      settled = true;
      return result;
    });
    await setTimeout(40);
    assert.equal(settled, false);
    await blocker.query('COMMIT');
    assert.equal((await waiting).status, 403);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await request(app)
    .delete(`/api/v1/safety/blocks/${bob.id}`)
    .set(auth(alice))
    .expect(204);

  const anonymous = {
    client: createClient(fixture.publicAuth.url, fixture.publicAuth.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
  const bypasses = [
    ['conversations', { type: 'group' }, 'id', group],
    [
      'conversation_members',
      { conversation_id: direct.id, user_id: carol.id, active: true },
      'conversation_id',
      direct.id,
    ],
    [
      'messages',
      {
        conversation_id: direct.id,
        sender_id: alice.id,
        body: 'Bypass',
        client_message_id: randomUUID(),
      },
      'id',
      first.id,
    ],
  ];
  for (const user of [alice, bob, carol, dan, anonymous]) {
    for (const [table, data, column, id] of bypasses) {
      assert.notEqual((await user.client.from(table).insert(data)).error, null);
      assert.notEqual(
        (await user.client.from(table).update(data).eq(column, id)).error,
        null,
      );
      assert.notEqual(
        (await user.client.from(table).delete().eq(column, id)).error,
        null,
      );
      if (user === anonymous)
        assert.notEqual(
          (await user.client.from(table).select('*')).error,
          null,
        );
    }
    for (const name of [
      'allocate_message_order',
      'guard_direct_membership',
      'guard_conversation_identity',
      'can_read_conversation',
    ])
      assert.notEqual(
        (
          await user.client.rpc(
            name,
            name === 'can_read_conversation' ? { target: direct.id } : {},
          )
        ).error,
        null,
      );
    assert.notEqual(
      (
        await user.client
          .schema('private')
          .rpc('can_read_conversation', { target: direct.id })
      ).error,
      null,
    );
  }
  // Accidental write grants still cannot bypass the SELECT-only browser policies.
  const probe = await migration.connect();
  try {
    await probe.query('BEGIN');
    await probe.query(
      'GRANT INSERT,UPDATE,DELETE ON public.conversations,public.conversation_members,public.messages TO authenticated',
    );
    await probe.query('SET LOCAL ROLE authenticated');
    await probe.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      carol.id,
    ]);
    assert.equal(
      (
        await probe.query('SELECT * FROM public.messages WHERE id=$1', [
          first.id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await probe.query(
          'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1',
          [direct.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await probe.query('DELETE FROM public.messages WHERE id=$1', [first.id]))
        .rowCount,
      0,
    );
    await probe.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      alice.id,
    ]);
    assert.equal(
      (
        await probe.query('SELECT * FROM public.messages WHERE id=$1', [
          first.id,
        ])
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await probe.query(
          'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1',
          [direct.id],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await probe.query('DELETE FROM public.messages WHERE id=$1', [first.id]))
        .rowCount,
      0,
    );
    await assert.rejects(
      probe.query("INSERT INTO public.conversations (type) VALUES ('group')"),
      { code: '42501' },
    );
  } finally {
    await probe.query('ROLLBACK');
    probe.release();
  }

  const [low, high] = [alice.id, bob.id].sort();
  for (const [sql, values, code] of [
    [
      "INSERT INTO public.conversations (type,direct_user_low,direct_user_high) VALUES ('direct',$1,$2)",
      [low, high],
      '23505',
    ],
    [
      "INSERT INTO public.conversations (type,direct_user_low,direct_user_high) VALUES ('direct',$1,$2)",
      [high, low],
      '23514',
    ],
    [
      "INSERT INTO public.conversations (type,direct_user_low,direct_user_high) VALUES ('direct',$1,$1)",
      [low],
      '23514',
    ],
    ["INSERT INTO public.conversations (type) VALUES ('direct')", [], '23514'],
    [
      "INSERT INTO public.conversations (type,direct_user_low,direct_user_high) VALUES ('group',$1,$2)",
      [low, high],
      '23514',
    ],
    [
      'INSERT INTO public.conversation_members (conversation_id,user_id) VALUES ($1,$2)',
      [direct.id, carol.id],
      '23514',
    ],
    [
      "UPDATE public.conversations SET type='group', direct_user_low=NULL,direct_user_high=NULL WHERE id=$1",
      [direct.id],
      '23514',
    ],
    [
      "INSERT INTO public.messages (conversation_id,sender_id,body,client_message_id) VALUES ($1,$2,' ',$3)",
      [direct.id, alice.id, randomUUID()],
      '23514',
    ],
    [
      "INSERT INTO public.messages (conversation_id,sender_id,body,client_message_id) VALUES ($1,$2,'bypass',$3)",
      [direct.id, carol.id, randomUUID()],
      '23514',
    ],
  ])
    await assert.rejects(migration.query(sql, values), { code });
  await assert.rejects(
    runtime.query(
      'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1',
      [direct.id],
    ),
    { code: '42501' },
  );
  await assert.rejects(
    runtime.query('UPDATE public.messages SET body=$1 WHERE id=$2', [
      'changed',
      first.id,
    ]),
    { code: '42501' },
  );

  const key = randomUUID();
  const keyed = (
    await insertMessage(
      runtime,
      direct.id,
      alice,
      'Synthetic deduplication',
      key,
    )
  ).rows[0];
  await assert.rejects(
    insertMessage(runtime, group, alice, 'Duplicate across conversations', key),
    { code: '23505' },
  );
  assert.equal(
    (
      await insertMessage(
        runtime,
        direct.id,
        bob,
        'Different sender same key',
        key,
      )
    ).rows[0].message_order,
    keyed.message_order + 1,
  );
  // A blocked allocation cannot commit a higher cursor before the previous insert.
  const writer = await runtime.connect();
  try {
    await writer.query('BEGIN');
    const held = (await insertMessage(writer, direct.id, alice)).rows[0];
    let settled = false;
    const waiting = insertMessage(runtime, direct.id, bob).then((result) => {
      settled = true;
      return result.rows[0];
    });
    await setTimeout(40);
    assert.equal(settled, false);
    assert.equal(
      (
        await migration.query('SELECT 1 FROM public.messages WHERE id=$1', [
          held.id,
        ])
      ).rowCount,
      0,
    );
    await writer.query('COMMIT');
    assert.equal((await waiting).message_order, held.message_order + 1);
    await writer.query('BEGIN');
    const rolled = (await insertMessage(writer, direct.id, alice)).rows[0];
    const next = insertMessage(runtime, direct.id, bob);
    await writer.query('ROLLBACK');
    assert.equal((await next).rows[0].message_order, rolled.message_order);
  } finally {
    await writer.query('ROLLBACK');
    writer.release();
  }
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () => insertMessage(runtime, direct.id, alice)),
  );
  const orders = concurrent
    .map((result) => result.rows[0].message_order)
    .sort((a, b) => a - b);
  assert.ok(orders.every((order, i) => order === orders[0] + i));

  // Persistent creation limits charge only a new pair; failed and repeat starts do not.
  const limited = fixture.makeApp({ ...developmentLimits, allowance: 1 });
  await start(dan, carol, limited).expect(200);
  await start(dan, bob, limited).expect(429);
  assert.equal((await read(dan, 'conversations', 'id', fresh.id)).length, 1);
  console.info(
    'Local conversations: canonical concurrent DM creation, restrictions/blocks and racing block, active-only private history and own revoked/pending membership status, stranger/guessed-ID/group isolation, browser writes/RPC and accidental-grant denials, constraints/deduplication, commit-ordered allocation/rollback/concurrency and persistent quotas passed.',
  );
} finally {
  await fixture.cleanup();
}
