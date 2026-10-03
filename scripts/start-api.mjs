import assert from 'node:assert/strict';
import process from 'node:process';

// Render supplies the commit of the actual build, including an explicit rollback.
assert.equal(process.versions.node, '24.13.0', 'Pinned Node runtime required.');
assert.match(process.env.RENDER_GIT_COMMIT ?? '', /^[a-f0-9]{40}$/);
assert.equal(process.env.CORS_ORIGINS, 'https://swapcircle-staging.pages.dev');
assert.equal(process.env.DATABASE_CA_CERT_PATH, '/etc/secrets/supabase-ca.crt');
assert.equal(process.env.MIGRATION_DATABASE_URL, undefined);
process.env.BUILD_REVISION = process.env.RENDER_GIT_COMMIT;

await import('../apps/api/dist/server.js');
