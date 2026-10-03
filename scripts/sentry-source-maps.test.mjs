import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadSourceMaps } from './sentry-source-maps.mjs';

test('private upload uses matching URLs and removes maps on success, rejection and missing credentials', async () => {
  const originalDirectory = process.cwd();
  const originalEnvironment = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), 'swapcircle-monitoring-'));

  try {
    process.chdir(directory);
    Object.assign(process.env, {
      BUILD_REVISION: 'a'.repeat(40),
      SENTRY_ORG: 'synthetic',
      SENTRY_API_PROJECT: 'api',
      SENTRY_WEB_PROJECT: 'web',
      SENTRY_AUTH_TOKEN: 'synthetic-token',
    });
    for (const outcome of ['success', 'rejected', 'missing']) {
      for (const path of ['apps/api/dist', 'apps/web/dist/assets']) {
        await mkdir(path, { recursive: true });
        await writeFile(
          `${path}/index.js`,
          'throw Error("synthetic");\n//# sourceMappingURL=index.js.map\n//# debugId=12345678-1234-1234-1234-123456789012',
        );
        await writeFile(`${path}/index.js.map`, '{}');
      }
      const calls = [];

      if (outcome === 'missing') delete process.env.SENTRY_AUTH_TOKEN;
      const operation = () =>
        uploadSourceMaps((args, project) => {
          calls.push({ args, project });
          if (outcome === 'rejected')
            throw new Error('Provider rejected upload');
        });

      if (outcome === 'success') {
        await operation();
        const uploads = calls.filter(({ args }) => args[1] === 'upload');

        assert.equal(uploads.length, 2);
        assert.ok(uploads[0].args.includes('app:///'));
        assert.ok(uploads[1].args.includes('app:///assets'));
        assert.ok(
          uploads.every(
            ({ args }) => args.includes('--wait') && args.includes('--strict'),
          ),
        );
        assert.ok(!JSON.stringify(calls).includes('synthetic-token'));
      } else await assert.rejects(operation);
      for (const path of ['apps/api/dist', 'apps/web/dist/assets']) {
        assert.deepEqual(await readdir(path), ['index.js']);
        const source = await readFile(`${path}/index.js`, 'utf8');

        assert.ok(!source.includes('sourceMappingURL'));
        assert.ok(source.includes('debugId='));
      }
    }
  } finally {
    process.chdir(originalDirectory);
    process.env = originalEnvironment;
    await rm(directory, { recursive: true, force: true });
  }
});
