import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decrypt, encrypt, externalPath } from '../scripts/backup-crypto.ts';

test('authenticated exports reject wrong keys, truncation and changed bytes', () => {
  const key = randomBytes(32);
  const body = Buffer.from('synthetic private message and image bytes');
  const archive = encrypt(body, key);
  assert.deepEqual(decrypt(archive, key), body);
  assert.ok(!archive.includes(body));
  assert.notDeepEqual(encrypt(body, key), archive);
  assert.throws(() => decrypt(archive, randomBytes(32)));
  assert.throws(() => decrypt(archive.subarray(0, archive.length - 1), key));
  const changed = Buffer.from(archive);
  changed[changed.length - 1]! ^= 1;
  assert.throws(() => decrypt(changed, key));
});

test('backup and key paths reject checkout and outside symlinks into checkout', async () => {
  await assert.rejects(externalPath(undefined));
  await assert.rejects(externalPath('backup.enc'));
  await assert.rejects(externalPath(process.cwd()));
  const temporary = await mkdtemp(join(tmpdir(), 'backup-path-'));
  try {
    await symlink(process.cwd(), join(temporary, 'checkout'));
    await assert.rejects(
      externalPath(join(temporary, 'checkout', 'secret.enc')),
    );
    await symlink(process.cwd(), join(temporary, 'leaf'));
    await assert.rejects(externalPath(join(temporary, 'leaf')));
    assert.ok(
      (await externalPath(join(temporary, 'synthetic.enc'))).endsWith(
        '/synthetic.enc',
      ),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
