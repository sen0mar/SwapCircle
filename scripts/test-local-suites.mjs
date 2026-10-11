// Suites stay sequential within each isolated runner: journeys share dist/.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

export const suites = {
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
      'accessibility',
      'backup',
      'password',
    ],
  },
};

export function selectSuites(kind, shard) {
  assert.ok(Object.hasOwn(suites, kind), 'Unknown local suite kind');
  const { workspace, names } = suites[kind];

  if (!shard) return { workspace, names };

  const match = /^(\d+)\/(\d+)$/.exec(shard);
  assert.ok(match, 'Shard must be index/count');
  const index = Number(match[1]);
  const count = Number(match[2]);
  assert.ok(index >= 1 && index <= count && count <= names.length);

  return {
    workspace,
    names: names.filter((_, position) => position % count === index - 1),
  };
}

// Keep the standalone scripts as the source of truth, but omit their repeated
// builds only after this runner has successfully built the API dependency graph.
export function preparedCommand(script) {
  const prefix =
    'pnpm --filter @swapcircle/contracts build && pnpm --filter @swapcircle/database build && ';
  assert.ok(script.startsWith(prefix));
  const command = script
    .slice(prefix.length)
    .replace(/^pnpm (?:--filter @swapcircle\/api )?build && /, '');
  assert.match(
    command,
    /^node (?:--env-file=\.\.\/\.\.\/packages\/database\/\.env )?test\/local-[a-z-]+\.mjs$/,
  );

  return command.split(' ');
}

async function main() {
  const kind = process.argv[2];
  assert.ok(process.argv.length === 3 || process.argv.length === 4);
  const shard = process.argv[3];
  const { names } = selectSuites(kind, shard);
  const directory = kind === 'api' ? 'api' : 'web';
  const cwd = new URL(`../apps/${directory}/`, import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL('package.json', cwd), 'utf8'),
  );
  const commands = names.map((name) =>
    preparedCommand(manifest.scripts[`test:${name}-local`]),
  );
  const buildStarted = Date.now();
  const build = spawn('pnpm', ['--filter', '@swapcircle/api...', 'build'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
  });
  const buildCode = await new Promise((resolve, reject) => {
    build.once('error', reject);
    build.once('close', resolve);
  });
  assert.equal(buildCode, 0, 'Shared suite build failed');
  console.log(
    `Shared API dependency build passed (${Date.now() - buildStarted}ms)`,
  );

  const results = [];
  const diagnostic = new URL(
    `../test-results/local-${kind}-failure.json`,
    import.meta.url,
  );

  for (const [index, name] of names.entries()) {
    const started = Date.now();
    console.log(`Starting ${kind}/${name}`);
    const child = spawn(commands[index][0], commands[index].slice(1), {
      cwd,
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
    const result = {
      suite: name,
      code,
      signal,
      elapsedMs: Date.now() - started,
    };
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
