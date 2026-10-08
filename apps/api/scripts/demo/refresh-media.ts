import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { databaseConfig, assertLocalRuntimeTarget } from '@swapcircle/database';
import {
  currentProfileSchema,
  listingSchema,
  listingPhotosSchema,
} from '@swapcircle/contracts';
import { createTokenVerifier } from '../../dist/auth/verify.js';
import { authenticate } from '../../dist/middleware/authenticate.js';
import { PHOTO_BUCKET } from '../../dist/features/photos/photos.storage.js';
import { ProfilesRepository } from '../../dist/features/profiles/profiles.repository.js';
import { PhotosRepository } from '../../dist/features/photos/photos.repository.js';
import { hostedSeedConfiguration, hostedReadiness } from './hosted.ts';
import { members, listings } from './manifest.ts';
import { openJournal, writePrivate } from './journal.ts';
import { DemoMediaRepository } from './media-refresh.repository.ts';
import {
  MediaRefreshService,
  mediaHash,
  prepareReplacement,
  type MediaReplacement,
} from './media-refresh.service.ts';

const root = new URL('../../../../', import.meta.url);
const hosted = process.argv.includes('--production');
const apply = process.argv.includes('--apply');
const args = process.argv.slice(2);
if (
  args.some((arg) => !['--production', '--apply'].includes(arg)) ||
  new Set(args).size !== args.length
)
  throw new Error('Unexpected media refresh arguments.');

const directory = new URL(
  hosted
    ? 'packages/database/.demo.hosted.local/'
    : 'packages/database/.demo.local/',
  root,
);
const backupDirectory = new URL('media-refresh/', directory);
const assetDirectory = new URL('packages/database/demo/assets/', root);
const previous = z
  .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
  .parse(
    JSON.parse(
      await readFile(
        new URL('packages/database/demo/previous-media.json', root),
        'utf8',
      ),
    ),
  );
const sources = z
  .record(
    z.string(),
    z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        prompt: z.string(),
      })
      .passthrough(),
  )
  .parse(
    JSON.parse(
      await readFile(
        new URL('packages/database/demo/sources.json', root),
        'utf8',
      ),
    ),
  );
let config: { API_URL: string; SERVICE_ROLE_KEY: string; ANON_KEY: string };
if (hosted) {
  config = hostedSeedConfiguration(process.env);
  await hostedReadiness(process.env);
} else {
  assertLocalRuntimeTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  config = z
    .object({
      API_URL: z.literal('http://127.0.0.1:55431'),
      SERVICE_ROLE_KEY: z.string(),
      ANON_KEY: z.string(),
    })
    .parse(
      JSON.parse(
        execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ),
    );
}

const credentials = z
  .object({
    authUrl: z.literal(config.API_URL),
    accounts: z.array(
      z.object({
        key: z.string(),
        id: z.uuid(),
        email: z.email(),
        password: z.string().min(20),
      }),
    ),
  })
  .parse(
    JSON.parse(await readFile(new URL('credentials.json', directory), 'utf8')),
  );
const journal = await openJournal(new URL('state.json', directory));
const lockPath = new URL('seed.lock', directory);
const lock = await open(lockPath, 'wx', 0o600);
const pool = new Pool(
  databaseConfig(process.env.DATABASE_URL, true, process.env),
);
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = admin.storage.from(PHOTO_BUCKET);
const photoRepository = new PhotosRepository(pool);
const profileRepository = new ProfilesRepository(pool);
const repository = new DemoMediaRepository(pool);
const server = createServer();

try {
  const actors = new Map<string, { id: string; token: string }>();
  for (const member of members) {
    const account = credentials.accounts.find(
      (account) => account.key === member.key,
    );
    if (!account) throw new Error('Demo credentials missing.');
    const client = createClient(config.API_URL, config.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    if (
      login.error ||
      !login.data.session ||
      login.data.user.id !== account.id ||
      login.data.user.app_metadata.demo_seed !== 'swapcircle-v1' ||
      (hosted && login.data.user.app_metadata.demo_target !== config.API_URL)
    )
      throw new Error('Verified seeded demo identity required.');
    actors.set(member.key, {
      id: account.id,
      token: login.data.session.access_token,
    });
  }

  const media: MediaReplacement[] = [];
  const add = async (
    ownerId: string,
    storageKey: string,
    asset: string,
    dimensions: { width: number; height: number },
    photoId?: string,
  ) => {
    const input = await readFile(new URL(`${asset}.jpg`, assetDirectory));
    if (
      !sources[asset] ||
      mediaHash(input) !== sources[asset]!.sha256 ||
      !previous[asset]
    )
      throw new Error('Generated asset provenance mismatch.');
    const body = await prepareReplacement(input, dimensions);
    if (body.length > 2 * 1024 * 1024)
      throw new Error('Generated image exceeds processed limit.');
    media.push({
      ownerId,
      storageKey,
      previousHash: previous[asset]!,
      body,
      ...(photoId ? { photoId } : {}),
    });
  };

  for (const [index, member] of members.entries()) {
    const actor = actors.get(member.key)!;
    const saved = journal.state.steps[`avatar/${member.key}`];
    if (!saved?.complete) throw new Error('Completed avatar seed required.');
    const original = currentProfileSchema.parse(saved.result);
    const current = await profileRepository.profile(actor.id);
    if (
      !current?.avatarStorageKey ||
      `${config.API_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${current.avatarStorageKey}` !==
        original.avatarUrl
    )
      throw new Error('Demo avatar record was edited.');
    const asset = await readFile(
      new URL(`avatar-${index}.jpg`, assetDirectory),
    );
    const dimensions = await sharp(asset).metadata();
    await add(actor.id, current.avatarStorageKey, `avatar-${index}`, {
      width: dimensions.width!,
      height: dimensions.height!,
    });
  }

  for (const item of listings) {
    const seeded = journal.state.steps[`listing/${item.key}`];
    if (!seeded?.complete) throw new Error('Completed listing seed required.');
    const listing = listingSchema.parse(seeded.result);
    const current = await photoRepository.active(listing.id);
    if (current.length !== item.images.length)
      throw new Error('Demo gallery was edited.');
    for (const [position, asset] of item.images.entries()) {
      const seededPhoto = journal.state.steps[`photo/${item.key}/${position}`];
      if (!seededPhoto?.complete)
        throw new Error('Completed photo seed required.');
      const saved = listingPhotosSchema
        .parse(seededPhoto.result)
        .find((photo) => photo.position === position);
      const row = current.find((photo) => photo.position === position);
      if (
        !saved ||
        !row ||
        saved.id !== row.id ||
        `${config.API_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${row.storageKey}` !==
          saved.url ||
        row.width !== saved.width ||
        row.height !== saved.height
      )
        throw new Error('Demo gallery record was edited.');
      await add(
        actors.get(item.owner)!.id,
        row.storageKey,
        asset,
        { width: row.width!, height: row.height! },
        row.id,
      );
    }
  }

  const storage = {
    async read(key: string) {
      const result = await bucket.download(key);
      if (result.error || !result.data) throw new Error('Storage read failed.');
      return Buffer.from(await result.data.arrayBuffer());
    },
    async backup(key: string, body: Buffer) {
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const path = new URL(
        `${mediaHash(Buffer.from(key))}.webp`,
        backupDirectory,
      );
      try {
        await writeFile(path, body, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          mediaHash(await readFile(path)) !== mediaHash(body)
        )
          throw new Error('Original media backup mismatch.', { cause: error });
      }
    },
    async replace(key: string, body: Buffer) {
      const result = await bucket.update(key, body, {
        contentType: 'image/webp',
        cacheControl: '0',
      });
      if (result.error) throw new Error('Storage replacement failed.');
    },
  };

  // Complete ownership and original-content preflight before any write.
  for (const replacement of media) {
    await repository.assertOwned(replacement);
    const hash = mediaHash(await storage.read(replacement.storageKey));
    if (![replacement.previousHash, mediaHash(replacement.body)].includes(hash))
      throw new Error('Demo media was edited; no refresh started.');
  }
  console.log(
    `${hosted ? 'Production' : 'Development'}: ${media.length} journal-owned media objects verified.`,
  );
  if (apply) {
    const photoIds = media.flatMap((item) =>
      item.photoId ? [item.photoId] : [],
    );
    const before = await repository.inventory(photoIds);
    await writePrivate(
      new URL('database-before.json', backupDirectory),
      before,
    );
    const service = new MediaRefreshService(repository, storage, media);
    const app = express();
    app.disable('x-powered-by');
    app.post(
      '/refresh/:index',
      authenticate(createTokenVerifier(config.API_URL, config.ANON_KEY)),
      async (request, response) => {
        try {
          const index = z.coerce
            .number()
            .int()
            .min(0)
            .max(media.length - 1)
            .parse(request.params.index);
          response.json(
            await service.replace(response.locals.identity.userId, index),
          );
        } catch {
          response.status(409).json({ error: 'Demo media refresh refused.' });
        }
      },
    );
    server.on('request', app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Loopback listener missing.');
    const receipts = [];
    for (const [index, replacement] of media.entries()) {
      const actor = [...actors.values()].find(
        (actor) => actor.id === replacement.ownerId,
      )!;
      const result = await fetch(
        `http://127.0.0.1:${address.port}/refresh/${index}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${actor.token}` },
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!result.ok)
        throw new Error(
          'Demo media refresh stopped; preserve backups and rerun.',
        );
      const receipt = z
        .object({ sha256: z.string(), bytes: z.number() })
        .parse(await result.json());
      receipts.push({ storageKey: replacement.storageKey, ...receipt });
      await writePrivate(new URL('receipts.json', backupDirectory), receipts);
    }
    const after = await repository.inventory(photoIds);
    await writePrivate(new URL('database-after.json', backupDirectory), after);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Unexpected database change during media refresh.');
    console.log(
      `${hosted ? 'Production' : 'Development'}: ${receipts.length} replacements uploaded and byte-verified; all other database fields preserved.`,
    );
  }
} catch {
  console.error(
    'Demo media refresh stopped safely. Inspect private journals locally; no credentials were logged.',
  );
  process.exitCode = 1;
} finally {
  if (server.listening)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await pool.end();
  await lock.close();
  await unlink(lockPath);
}
