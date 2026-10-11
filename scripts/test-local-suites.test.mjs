import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { URL } from 'node:url';
import { preparedCommand, selectSuites, suites } from './test-local-suites.mjs';

test('journey shards cover every suite exactly once and retain ordering', () => {
  assert.equal(suites.api.names.length, 19);
  assert.equal(suites.journeys.names.length, 18);
  const shards = [1, 2, 3].map(
    (index) => selectSuites('journeys', `${index}/3`).names,
  );
  const combined = shards.flat();
  assert.equal(new Set(combined).size, suites.journeys.names.length);
  assert.deepEqual(combined.toSorted(), suites.journeys.names.toSorted());
  assert.ok(shards.every((names) => names.length === 6));
  assert.deepEqual(selectSuites('api').names, suites.api.names);
  for (const shard of ['0/3', '4/3', '1/0', '1/19', '1/3 extra', '-1/3'])
    assert.throws(() => selectSuites('journeys', shard));
  assert.throws(() => selectSuites('unknown'));
});

test('prepared execution preserves every standalone node command and environment', async () => {
  for (const [kind, { names }] of Object.entries(suites)) {
    const directory = kind === 'api' ? 'api' : 'web';
    const manifest = JSON.parse(
      await readFile(
        new URL(`../apps/${directory}/package.json`, import.meta.url),
      ),
    );
    for (const name of names) {
      const script = manifest.scripts[`test:${name}-local`];
      assert.equal(
        preparedCommand(script).join(' '),
        script.split(' && ').at(-1),
      );
    }
  }
  for (const script of [
    'node test/local-auth.mjs',
    'pnpm build && node missing',
  ])
    assert.throws(() => preparedCommand(script));
});

test('database gate requires all isolated jobs and does not receive secrets', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const gate = workflow
    .split('  database:\n')[1]
    .split('  private-source-maps:')[0];
  assert.match(
    gate,
    /if: always\(\) && github.event_name != 'workflow_dispatch'/,
  );
  assert.match(gate, /needs: \[api-local, journeys-local\]/);
  assert.match(
    gate,
    /test "\$API_RESULT" = success && test "\$JOURNEYS_RESULT" = success/,
  );
  const local = workflow
    .split('  api-local:\n')[1]
    .split('  private-source-maps:')[0];
  assert.doesNotMatch(local, /secrets\.|environment: production/);
  assert.match(local, /fail-fast: false/);
  assert.match(local, /matrix:\n {8}shard: \[1, 2, 3\]/);
  assert.equal((local.match(/run: pnpm db:reset/g) ?? []).length, 2);
  assert.match(local, /Verify migration generation has no drift/);
});

test('database gate fails closed for failed, cancelled, skipped or missing groups', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const gate = workflow
    .split('  database:\n')[1]
    .split('  private-source-maps:')[0];
  const command = gate.match(/run: (test[^\n]+)/)[1];
  for (const api of ['success', 'failure', 'cancelled', 'skipped', '']) {
    for (const journeys of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const { status } = spawnSync('sh', ['-c', command], {
        env: { API_RESULT: api, JOURNEYS_RESULT: journeys },
      });
      assert.equal(status === 0, api === 'success' && journeys === 'success');
    }
  }
});

test('a failed shared build prevents every integration suite from starting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swapcircle-suite-build-'));
  try {
    const executable = join(directory, 'pnpm');
    await writeFile(executable, '#!/bin/sh\nexit 23\n');
    await chmod(executable, 0o700);
    const result = spawnSync(
      process.execPath,
      [new URL('./test-local-suites.mjs', import.meta.url).pathname, 'api'],
      {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        encoding: 'utf8',
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Shared suite build failed/);
    assert.doesNotMatch(result.stdout, /Starting api\//);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
