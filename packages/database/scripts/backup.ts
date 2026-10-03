// Hosted exports require explicit target authorization; restore remains local-only.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { assertLocalTarget, databaseConfig } from '../src/config.ts';
import { approvedHostedTarget } from './backup-target.ts';
import {
  externalPath,
  loadKey,
  MAX_BACKUP_BYTES,
  readEncrypted,
  saveEncrypted,
} from './backup-crypto.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const container = 'supabase_db_swapcircle-local';
const bucket = 'item-media';
const command = process.argv[2];
let hostedDatabase: URL | undefined;

async function databaseTool(tool: string, args: string[], input?: Buffer) {
  if (hostedDatabase) {
    if (tool !== 'pg_dump') throw new Error('Hosted restore is refused.');
    const bin = await externalPath(process.env.BACKUP_PG_BIN);
    return execFileSync(join(bin, tool), args, {
      env: {
        ...process.env,
        PGHOST: hostedDatabase.hostname,
        PGPORT: hostedDatabase.port || '5432',
        PGDATABASE: 'postgres',
        PGUSER: decodeURIComponent(hostedDatabase.username),
        PGPASSWORD: decodeURIComponent(hostedDatabase.password),
        PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: process.env.BACKUP_CA_FILE,
      },
      maxBuffer: MAX_BACKUP_BYTES,
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return execFileSync(
    'docker',
    [
      'exec',
      ...(input ? ['-i'] : []),
      container,
      tool,
      '-U',
      tool === 'psql' ? 'supabase_admin' : 'postgres',
      '-d',
      'postgres',
      ...args,
    ],
    {
      input,
      maxBuffer: MAX_BACKUP_BYTES,
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

async function imageBytes(response: Response) {
  if (!response.ok || !response.body)
    throw new Error('Storage download failed.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024)
        throw new Error('Storage object size bound exceeded.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

async function main() {
  if (process.argv.length !== 3)
    throw new Error('Additional arguments refused.');
  const hosted = process.env.BACKUP_AUTHORIZATION === 'approved-hosted-export';
  if (hosted) {
    hostedDatabase = approvedHostedTarget(process.env, command);
  } else {
    if (process.env.BACKUP_LOCAL_MAINTENANCE !== 'synthetic-offline')
      throw new Error('Requires an offline isolated synthetic environment.');
    assertLocalTarget(process.env.MIGRATION_DATABASE_URL, process.env.NODE_ENV);
  }
  const keyPath = await externalPath(process.env.BACKUP_KEY_FILE);
  if (command === 'key') {
    await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    return;
  }
  const path = await externalPath(process.env.BACKUP_FILE);
  const key = await loadKey(keyPath);
  const status = hosted
    ? {
        API_URL: process.env.BACKUP_SUPABASE_URL!,
        DB_URL: process.env.BACKUP_DATABASE_URL!,
        SERVICE_ROLE_KEY: process.env.BACKUP_SERVICE_ROLE_KEY!,
      }
    : (JSON.parse(
        execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ) as { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY: string });
  if (!hosted) {
    assertLocalTarget(status.DB_URL, process.env.NODE_ENV);
    if (status.API_URL !== 'http://127.0.0.1:55431')
      throw new Error('Unexpected Storage target.');
  }
  const pool = new Pool({
    ...databaseConfig(status.DB_URL, false),
    ...(hosted
      ? {
          ssl: {
            rejectUnauthorized: true,
            ca: await readFile(process.env.BACKUP_CA_FILE!, 'utf8'),
          },
        }
      : {}),
  });
  try {
    const history = (
      await pool.query(
        'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id',
      )
    ).rows;
    const schema = createHash('sha256')
      .update(JSON.stringify(history))
      .digest('hex');
    const headers = {
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      apikey: status.SERVICE_ROLE_KEY,
    };
    const objectUrl = (name: string) =>
      `${status.API_URL}/storage/v1/object/${bucket}/${name.split('/').map(encodeURIComponent).join('/')}`;
    const tables = (
      await pool.query<{ name: string }>(
        `SELECT quote_ident(c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND NOT EXISTS
       (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
       ORDER BY c.relname`,
      )
    ).rows;
    if (command === 'database-export') {
      const dump = await databaseTool('pg_dump', [
        '--data-only',
        '--disable-triggers',
        ...tables.map((row) => `--table=public.${row.name}`),
        '--table=auth.users',
        '--table=auth.identities',
      ]);
      await saveEncrypted(
        path,
        Buffer.from(
          JSON.stringify({
            kind: 'database',
            schema,
            dump: dump.toString('base64'),
          }),
        ),
        key,
      );
    } else if (command === 'database-restore') {
      const archive = JSON.parse(
        (await readEncrypted(path, key)).toString(),
      ) as { kind: string; schema: string; dump: string };
      if (
        archive.kind !== 'database' ||
        archive.schema !== schema ||
        typeof archive.dump !== 'string'
      )
        throw new Error(
          'Migrate the isolated target to the exported version first.',
        );
      // The authenticated archive is fully decrypted before any mutation. Truncate and
      // COPY restore share one transaction, including trigger disabling from pg_dump.
      const prefix = `TRUNCATE ${tables.map((row) => `public.${row.name}`).join(',')}, auth.users, auth.identities CASCADE;\n`;
      await databaseTool(
        'psql',
        [
          '--no-psqlrc',
          '--set=ON_ERROR_STOP=1',
          '--single-transaction',
          '--file=-',
        ],
        Buffer.concat([
          Buffer.from(prefix),
          Buffer.from(archive.dump, 'base64'),
        ]),
      );
    } else if (command === 'storage-export') {
      const objects = (
        await pool.query<{ name: string }>(
          'SELECT name FROM storage.objects WHERE bucket_id=$1 ORDER BY name LIMIT 10001',
          [bucket],
        )
      ).rows;
      if (objects.length > 10000)
        throw new Error('Storage object bound exceeded.');
      const entries = [];
      let bytes = 0;
      for (const { name } of objects) {
        const response = await fetch(objectUrl(name), {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('Storage download failed.');
        const body = await imageBytes(response);
        bytes += body.length;
        if (body.length > 2 * 1024 * 1024 || bytes > 128 * 1024 * 1024)
          throw new Error('Storage size bound exceeded.');
        entries.push({
          name,
          body: body.toString('base64'),
          hash: createHash('sha256').update(body).digest('hex'),
        });
      }
      await saveEncrypted(
        path,
        Buffer.from(
          JSON.stringify({ kind: 'storage', schema, bucket, entries }),
        ),
        key,
      );
    } else if (command === 'storage-restore') {
      const archive = JSON.parse(
        (await readEncrypted(path, key)).toString(),
      ) as {
        kind: string;
        schema: string;
        bucket: string;
        entries: { name: string; body: string; hash: string }[];
      };
      if (
        archive.kind !== 'storage' ||
        archive.schema !== schema ||
        archive.bucket !== bucket ||
        !Array.isArray(archive.entries) ||
        archive.entries.length > 10000
      )
        throw new Error('Invalid Storage archive.');
      const names = new Set<string>();
      // Validate every entry before the first upload. Restoration is retryable but
      // not atomic across Storage/DB; keep the application offline until verified.
      for (const entry of archive.entries) {
        if (
          typeof entry.name !== 'string' ||
          !entry.name ||
          entry.name
            .split('/')
            .some((part) => !part || part === '.' || part === '..') ||
          names.has(entry.name)
        )
          throw new Error('Invalid object path.');
        names.add(entry.name);
        const body = Buffer.from(entry.body, 'base64');
        if (
          body.length > 2 * 1024 * 1024 ||
          createHash('sha256').update(body).digest('hex') !== entry.hash
        )
          throw new Error('Invalid object bytes.');
      }
      for (const entry of archive.entries) {
        const response = await fetch(objectUrl(entry.name), {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'image/webp',
            'x-upsert': 'true',
          },
          body: Buffer.from(entry.body, 'base64'),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw new Error(
            'Storage restoration failed; keep app offline and retry.',
          );
        const restored = await fetch(objectUrl(entry.name), {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (
          !restored.ok ||
          createHash('sha256')
            .update(await imageBytes(restored))
            .digest('hex') !== entry.hash
        )
          throw new Error('Storage verification failed.');
      }
      const references = (
        await pool.query<{ name: string }>(
          "SELECT storage_key AS name FROM public.listing_photos WHERE state='active' UNION SELECT avatar_storage_key FROM public.profiles WHERE avatar_storage_key IS NOT NULL",
        )
      ).rows;
      if (references.some((row) => !names.has(row.name)))
        throw new Error('Restored database references missing images.');
    } else throw new Error('Unknown backup command.');
  } finally {
    await pool.end();
    key.fill(0);
  }
}

main()
  .then(() => console.log('Isolated encrypted backup operation completed.'))
  .catch((error: unknown) => {
    if (process.env.BACKUP_LOCAL_MAINTENANCE === 'synthetic-offline') {
      const output = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      const location = output.match(/psql:<stdin>:\d+/)?.[0];
      if (location) console.error(`Local restore failed at ${location}.`);
      const category = output.match(
        /ERROR: (permission denied|must be owner|unrecognized configuration parameter|duplicate key|insert or update on table|cannot truncate|syntax error|relation|invalid command)/,
      )?.[1];
      if (category) console.error(`Local restore category: ${category}.`);
    }
    // Tool/SQL/HTTP exceptions may contain secrets or data. Never echo them.
    console.error(
      'Backup operation failed. Check private configuration, archive and offline local target; no private data was logged.',
    );
    process.exitCode = 1;
  });
