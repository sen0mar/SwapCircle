import process from 'node:process';
import console from 'node:console';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cli = require('@sentry/cli').SentryCli.getPath();

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );

  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(`${directory}/${entry.name}`)
          : `${directory}/${entry.name}`,
      ),
    )
  ).flat();
}

function execute(args, project) {
  const result = spawnSync(cli, args, {
    env: { ...process.env, SENTRY_PROJECT: project, SENTRY_LOG_LEVEL: 'error' },
    stdio: 'pipe',
    timeout: 180000,
  });

  // Provider output is not trusted to redact credentials. Never echo it.
  if (result.status !== 0)
    throw new Error(
      'Private source-map operation failed; inspect Sentry permissions and configuration.',
    );
}

export async function uploadSourceMaps(run = execute) {
  const revision = process.env.BUILD_REVISION;

  const targets = [
    {
      directory: 'apps/api/dist',
      prefix: 'app:///',
      project: process.env.SENTRY_API_PROJECT,
    },
    {
      directory: 'apps/web/dist/assets',
      prefix: 'app:///assets',
      project: process.env.SENTRY_WEB_PROJECT,
    },
  ];

  try {
    if (!revision || !/^[a-f0-9]{40}$/.test(revision))
      throw new Error('A full build revision is required.');
    for (const name of [
      'SENTRY_AUTH_TOKEN',
      'SENTRY_ORG',
      'SENTRY_API_PROJECT',
      'SENTRY_WEB_PROJECT',
    ]) {
      if (!process.env[name]) throw new Error(`Missing ${name}.`);
    }

    for (const { directory, prefix, project } of targets) {
      const maps = (await files(directory)).filter((file) =>
        file.endsWith('.js.map'),
      );

      if (!maps.length)
        throw new Error('Private source maps were not generated.');
      run(['sourcemaps', 'inject', directory], project);
      run(
        [
          'sourcemaps',
          'upload',
          '--release',
          revision,
          '--url-prefix',
          prefix,
          '--validate',
          '--strict',
          '--wait',
          directory,
        ],
        project,
      );
      console.info(
        `Private source maps processed: ${directory} (${maps.length} maps).`,
      );
    }
  } finally {
    // Even a rejected upload cannot leave maps or public map references behind.
    for (const { directory } of targets) {
      for (const file of await files(directory)) {
        if (file.endsWith('.map')) await rm(file);
        else if (file.endsWith('.js')) {
          const text = await readFile(file, 'utf8');

          await writeFile(
            file,
            text.replace(/^\/\/[#@] sourceMappingURL=.*$/gm, ''),
          );
        }
      }
    }
  }

  for (const { directory } of targets) {
    for (const file of await files(directory)) {
      if (
        file.endsWith('.map') ||
        (file.endsWith('.js') &&
          /^\s*\/\/[#@] sourceMappingURL=/m.test(await readFile(file, 'utf8')))
      ) {
        throw new Error('Public build contains a source-map reference.');
      }
    }
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await uploadSourceMaps();
}
