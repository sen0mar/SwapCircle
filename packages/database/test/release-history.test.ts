import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifiedHistoryPrefix } from '../scripts/release-history.ts';

const migrations = Array.from({ length: 25 }, (_, index) => ({
  hash: `reviewed-${index}`,
  folderMillis: 1000 + index,
}));
const history = migrations.map((migration) => ({
  hash: migration.hash,
  created_at: String(migration.folderMillis),
}));

test('reviewed pending suffix accepts intact hosted baseline; complete replay accepts exact history', () => {
  verifiedHistoryPrefix(history.slice(0, 24), migrations);
  verifiedHistoryPrefix(history, migrations);
});

test('migration release refuses missing baseline, changed hashes/times and unknown or extra history', () => {
  assert.throws(() => verifiedHistoryPrefix(history.slice(0, 23), migrations));
  assert.throws(() => verifiedHistoryPrefix(history, migrations.slice(0, 24)));
  assert.throws(() =>
    verifiedHistoryPrefix([...history, history[0]!], migrations),
  );
  assert.throws(() =>
    verifiedHistoryPrefix(
      [{ ...history[0]!, hash: 'unknown' }, ...history.slice(1)],
      migrations,
    ),
  );
  assert.throws(() =>
    verifiedHistoryPrefix(
      [{ ...history[0]!, created_at: '9' }, ...history.slice(1)],
      migrations,
    ),
  );
});
