import { URL } from 'node:url';
// Test-only Express process with least-privilege local runtime credentials.
import process from 'node:process';
import { Pool } from 'pg';
import { databaseConfig } from '@swapcircle/database';
import { createApp } from '../dist/app.js';
import { createTokenVerifier } from '../dist/auth/verify.js';
import { ListingsRepository } from '../dist/features/listings/listings.repository.js';
import { ListingsService } from '../dist/features/listings/listings.service.js';
import {
  SafetyPermissions,
  developmentLimits,
} from '../dist/features/safety/safety.permissions.js';
import { SafetyRepository } from '../dist/features/safety/safety.repository.js';
import { SafetyService } from '../dist/features/safety/safety.service.js';
import assert from 'node:assert/strict';
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55432');
assert.equal(process.env.NODE_ENV, 'development');
const pool = new Pool(databaseConfig(process.env.DATABASE_URL));
const limits = { ...developmentLimits, allowance: 2 };
const permissions = new SafetyPermissions(limits);
const server = createApp({
  allowedOrigins: [],
  limits,
  verifyToken: createTokenVerifier(
    process.env.LOCAL_AUTH_URL,
    process.env.LOCAL_AUTH_KEY,
  ),
  safety: new SafetyService(new SafetyRepository(pool), permissions),
  listings: new ListingsService(new ListingsRepository(pool, permissions)),
}).listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('SIGTERM', () =>
  server.close(async () => {
    await pool.end();
    process.exit(0);
  }),
);
