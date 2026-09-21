import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLocalAuthConfig } from '../scripts/auth-config.ts';

for (const scenario of ['absent', 'configured', 'startup-failure', 'partial']) {
  test(`local Google configuration: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'swapcircle-auth-'));

    mkdirSync(`${root}/supabase`);

    const path = `${root}/supabase/config.toml`;
    const original = '[auth.external.google]\nenabled = false\n';

    writeFileSync(path, original);

    if (scenario !== 'absent')
      writeFileSync(
        `${root}/.env`,
        `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=synthetic-id\n${scenario === 'partial' ? '' : 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=synthetic-secret\n'}`,
      );

    try {
      const run = () =>
        withLocalAuthConfig(
          root,
          (environment) => {
            assert.equal(
              readFileSync(path, 'utf8').includes('enabled = true'),
              scenario !== 'absent',
            );

            if (scenario !== 'absent')
              assert.equal(
                environment.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET,
                'synthetic-secret',
              );

            if (scenario === 'startup-failure')
              throw new Error('synthetic failure');
          },
          {},
        );

      if (scenario === 'partial' || scenario === 'startup-failure')
        assert.throws(run);
      else run();

      assert.equal(readFileSync(path, 'utf8'), original);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
}
