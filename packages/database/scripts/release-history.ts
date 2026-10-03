import assert from 'node:assert/strict';

// Existing hosted baseline must remain intact. Increasing the reviewed list/digest
// requires explicit compatible-migration review; routine releases never erase it.
export const hostedBaselineLength = 24;

export function verifiedHistoryPrefix(
  history: { hash: string; created_at: string | number }[],
  migrations: { hash: string; folderMillis: number }[],
) {
  assert.ok(migrations.length >= hostedBaselineLength);
  assert.ok(history.length >= hostedBaselineLength);
  assert.ok(history.length <= migrations.length);

  history.forEach((row, index) => {
    assert.equal(row.hash, migrations[index]!.hash);
    assert.equal(Number(row.created_at), migrations[index]!.folderMillis);
  });
}
