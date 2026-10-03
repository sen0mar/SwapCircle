// Keep builds and synthetic fixtures sequential: browser journeys share dist/.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const suites = {
  api: {
    workspace: '@swapcircle/api',
    names: [
      'auth',
      'profiles',
      'listings',
      'photos',
      'discovery',
      'safety',
      'conversations',
      'messages',
      'unread',
      'notifications',
      'trades',
      'proposals',
      'groups',
      'revisions',
      'acceptances',
      'lifecycle',
      'outcomes',
      'coffee',
      'meetings',
    ],
  },
  journeys: {
    workspace: '@swapcircle/web',
    names: [
      'catalog',
      'safety',
      'inbox',
      'composer',
      'realtime',
      'unread',
      'notifications',
      'swaps',
      'groups',
      'revisions',
      'acceptances',
      'coffee',
      'meetings',
      'lifecycle',
      'completion',
    ],
  },
};
const kind = process.argv[2];
assert.ok(Object.hasOwn(suites, kind) && process.argv.length === 3);
const { workspace, names } = suites[kind];
const results = [];
const diagnostic = new URL(
  `../test-results/local-${kind}-failure.json`,
  import.meta.url,
);

for (const name of names) {
  const started = Date.now();
  console.log(`Starting ${kind}/${name}`);
  const child = spawn('pnpm', ['--filter', workspace, `test:${name}-local`], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Retain only a bounded tail in memory. Never persist Auth/SQL/HTTP payloads,
  // assertion diffs, private reports, or build environments in CI artifacts.
  let tail = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      tail = (tail + chunk.toString()).slice(-32768);
    });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const result = { suite: name, code, signal, elapsedMs: Date.now() - started };
  results.push(result);
  console.log(
    `${kind}/${name}: ${code === 0 ? 'passed' : 'failed'} (${result.elapsedMs}ms)`,
  );
  if (code !== 0) {
    // Stack locations locate the failed assertion without disclosing its values.
    const locations = tail
      .split('\n')
      .filter((line) =>
        /^\s+at .*\.(?:mjs|[cm]?js|tsx?):\d+:\d+\)?$/.test(line),
      )
      .slice(-12);
    console.error(locations.join('\n'));
    await mkdir(new URL('../test-results/', import.meta.url), {
      recursive: true,
    });
    await writeFile(
      diagnostic,
      JSON.stringify({ kind, results, locations }, null, 2),
    );
    process.exitCode = 1;
    break;
  }
}
