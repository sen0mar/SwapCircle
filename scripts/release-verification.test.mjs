import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReleaseEvidence } from './release-verification.mjs';

test('public audit requires the same expected healthy frontend and API revision', () => {
  const revision = 'a'.repeat(40);
  const frontend = { revision };
  const api = { revision, status: 'ready' };

  assertReleaseEvidence(frontend, api, revision);

  for (const candidate of [undefined, 'main', 'a'.repeat(39)]) {
    assert.throws(() => assertReleaseEvidence(frontend, api, candidate));
  }

  assert.throws(() =>
    assertReleaseEvidence({ revision: 'b'.repeat(40) }, api, revision),
  );
  assert.throws(() =>
    assertReleaseEvidence(
      frontend,
      { ...api, revision: 'b'.repeat(40) },
      revision,
    ),
  );
  assert.throws(() =>
    assertReleaseEvidence(
      frontend,
      { ...api, status: 'unavailable' },
      revision,
    ),
  );
});
