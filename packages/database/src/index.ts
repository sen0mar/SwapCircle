import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { databaseConfig } from './config.js';
import * as schema from './schema.js';

export { databaseConfig } from './config.js';

export function createDatabase(connectionString: string | undefined) {
  const pool = new Pool(databaseConfig(connectionString));

  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
