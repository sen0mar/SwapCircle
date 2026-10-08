import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import pino from 'pino';
import { z } from 'zod';
import { assertLocalRuntimeTarget, databaseConfig } from '@swapcircle/database';
import {
  currentProfileSchema as profileSchema,
  listingSchema,
  listingPageSchema,
  listingPhotosSchema,
  interestCatalogueSchema,
  proposalCreationResultSchema,
  tradeDetailSchema,
  tradeAcceptanceResultSchema,
  tradeTransitionResultSchema,
  tradeOutcomeResultSchema,
  meetupSchema,
  directConversationReceiptSchema,
  messageReceiptSchema,
  coffeeInvitationSchema,
} from '@swapcircle/contracts';
import { createApp } from '../../dist/app.js';
import { createTokenVerifier } from '../../dist/auth/verify.js';
import { createPhotoStorage } from '../../dist/features/photos/photos.storage.js';
import { ProfilesRepository } from '../../dist/features/profiles/profiles.repository.js';
import { ProfilesService } from '../../dist/features/profiles/profiles.service.js';
import { ListingsRepository } from '../../dist/features/listings/listings.repository.js';
import { ListingsService } from '../../dist/features/listings/listings.service.js';
import { PhotosRepository } from '../../dist/features/photos/photos.repository.js';
import { PhotosService } from '../../dist/features/photos/photos.service.js';
import { TradesRepository } from '../../dist/features/trades/trades.repository.js';
import { TradesService } from '../../dist/features/trades/trades.service.js';
import { MeetingsRepository } from '../../dist/features/meetings/meetings.repository.js';
import { MeetingsService } from '../../dist/features/meetings/meetings.service.js';
import { CoffeeRepository } from '../../dist/features/coffee/coffee.repository.js';
import { CoffeeService } from '../../dist/features/coffee/coffee.service.js';
import { NotificationsRepository } from '../../dist/features/notifications/notifications.repository.js';
import { NotificationsService } from '../../dist/features/notifications/notifications.service.js';
import { ConversationsRepository } from '../../dist/features/conversations/conversations.repository.js';
import { ConversationsService } from '../../dist/features/conversations/conversations.service.js';
import { assertDemoTarget } from '../../dist/features/development/demo-guard.js';
import { members, listings, swaps, type MemberKey } from './manifest.ts';
import { openJournal, writePrivate } from './journal.ts';
import {
  hostedSeedConfiguration,
  hostedReadiness,
  hostedInventory,
} from './hosted.ts';
import { hostedDemoApi } from '../../dist/features/development/demo-guard.js';

const root = new URL('../../../../', import.meta.url);
const hosted = process.argv[2] === '--production';
const directory = new URL(
  hosted
    ? 'packages/database/.demo.hosted.local/'
    : 'packages/database/.demo.local/',
  root,
);
const credentialsPath = new URL('credentials.json', directory);
const assetRoot = new URL('packages/database/demo/assets/', root);
const accountSchema = z.object({
  key: z.string(),
  id: z.uuid().optional(),
  email: z.email(),
  password: z.string().min(20),
});
const credentialsSchema = z.object({
  version: z.literal(1),
  authUrl: z.literal(
    hosted
      ? 'https://tpanyqfgmbpsiejqjocd.supabase.co'
      : 'http://127.0.0.1:55431',
  ),
  accounts: z.array(accountSchema),
});
const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};

class DemoError extends Error {}

async function localConfiguration() {
  assertLocalRuntimeTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
  const localStatus = z
    .object({
      API_URL: z.literal('http://127.0.0.1:55431'),
      DB_URL: z.string(),
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
  assertDemoTarget(
    process.env.NODE_ENV,
    localStatus.API_URL,
    process.env.DATABASE_URL,
  );
  const dbTarget = new URL(localStatus.DB_URL);
  if (
    dbTarget.hostname !== '127.0.0.1' ||
    dbTarget.port !== '55432' ||
    dbTarget.pathname !== '/postgres' ||
    dbTarget.search ||
    dbTarget.hash
  )
    throw new DemoError('Unexpected CLI database target.');
  const project = await readFile(new URL('supabase/config.toml', root), 'utf8');
  if (!project.includes('project_id = "swapcircle-local"'))
    throw new DemoError('Unexpected project.');

  return localStatus;
}

async function main() {
  if (process.argv.length !== (hosted ? 3 : 2))
    throw new DemoError('Extra seed arguments refused.');
  const status = hosted
    ? hostedSeedConfiguration(process.env)
    : await localConfiguration();
  if (hosted) await hostedReadiness(process.env);

  // Every asset is present before creating any identity or app record.
  for (const name of new Set([
    ...listings.flatMap((item) => item.images),
    ...members.map((_, index) => `avatar-${index}`),
  ]))
    await readFile(new URL(`${name}.jpg`, assetRoot));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = new URL('seed.lock', directory);
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new DemoError(
      'A seed lock exists. Confirm no seed is running before removing the local lock.',
    );
  });
  const pool = hosted
    ? undefined
    : new Pool(databaseConfig(process.env.DATABASE_URL));
  let server: import('node:http').Server | undefined;

  try {
    if (hosted)
      await hostedInventory(process.env, new URL('baseline.json', directory));
    const journal = await openJournal(new URL('state.json', directory));
    let credentials: z.infer<typeof credentialsSchema>;
    try {
      credentials = credentialsSchema.parse(
        JSON.parse(await readFile(credentialsPath, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new DemoError(
          'Invalid demo credentials. Preserve the file and inspect locally.',
        );
      if (Object.keys(journal.state.steps).length)
        throw new DemoError(
          'Existing journal has no credentials; refusing to create replacement accounts.',
        );
      credentials = {
        version: 1,
        authUrl: status.API_URL,
        accounts: members.map((member) => ({
          key: member.key,
          email: `swapcircle-demo-${hosted ? 'prod-' : ''}${member.key}@example.invalid`,
          password: randomBytes(32).toString('base64url'),
        })),
      };
      await writePrivate(credentialsPath, credentials);
    }
    const admin = createClient(
      status.API_URL,
      status.SERVICE_ROLE_KEY,
      authOptions,
    );
    let origin = hostedDemoApi;
    if (pool) {
      const storage = createPhotoStorage(
        status.API_URL,
        status.SERVICE_ROLE_KEY,
      );
      const app = createApp({
        logger: pino({ level: 'silent' }),
        allowedOrigins: ['http://127.0.0.1:5173'],
        verifyToken: createTokenVerifier(status.API_URL, status.ANON_KEY),
        profiles: new ProfilesService(new ProfilesRepository(pool), storage),
        listings: new ListingsService(new ListingsRepository(pool)),
        photos: new PhotosService(new PhotosRepository(pool), storage),
        trades: new TradesService(new TradesRepository(pool)),
        meetings: new MeetingsService(new MeetingsRepository(pool)),
        coffee: new CoffeeService(new CoffeeRepository(pool)),
        conversations: new ConversationsService(
          new ConversationsRepository(pool),
        ),
        notifications: new NotificationsService(
          new NotificationsRepository(pool),
        ),
      });
      // Fixed loopback listener, not a caller-supplied API URL. No live server needed.
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve, reject) => {
        server!.once('listening', resolve);
        server!.once('error', reject);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new DemoError('No local listener.');
      origin = `http://127.0.0.1:${address.port}`;
    }
    const actors = new Map<
      MemberKey,
      { id: string; token: string; client: SupabaseClient }
    >();

    async function request<T>(
      key: MemberKey | null,
      path: string,
      schema: z.ZodType<T>,
      body?: unknown,
      method = body === undefined ? 'GET' : 'POST',
      image?: Buffer,
    ): Promise<T> {
      // Keep the existing IP burst limiter intact; comfortably below 60 writes/min.
      if (method !== 'GET')
        await new Promise((resolve) => setTimeout(resolve, 1100));
      const response = await fetch(`${origin}/api/v1${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          ...(hosted ? { Origin: 'https://swapcircle.pages.dev' } : {}),
          ...(key ? { Authorization: `Bearer ${actors.get(key)!.token}` } : {}),
          ...(image
            ? { 'Content-Type': 'image/jpeg' }
            : body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
        },
        ...(image
          ? { body: new Uint8Array(image) }
          : body === undefined
            ? {}
            : { body: JSON.stringify(body) }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const code = z
          .object({ error: z.object({ code: z.string().regex(/^[A-Z_]+$/) }) })
          .safeParse(result);
        throw new DemoError(
          `Seed action refused (${response.status}${code.success ? ` ${code.data.error.code}` : ''}). Existing data was preserved; rerun to resume.`,
        );
      }
      return schema.parse(result);
    }

    for (const member of members) {
      const account = credentials.accounts.find(
        (account) => account.key === member.key,
      );
      if (!account) throw new DemoError('Account manifest changed.');
      if (!account.id) {
        // Recover an interrupted Auth creation only when server-owned metadata matches.
        let found: import('@supabase/supabase-js').User | undefined;
        for (let page = 1; ; page++) {
          const result = await admin.auth.admin.listUsers({
            page,
            perPage: 100,
          });
          if (result.error)
            throw new DemoError('Demo Auth inventory unavailable.');
          found = result.data.users.find(
            (user) => user.email === account.email,
          );
          if (found || result.data.users.length < 100) break;
        }
        if (
          found &&
          (found.app_metadata.demo_seed !== 'swapcircle-v1' ||
            (hosted && found.app_metadata.demo_target !== status.API_URL))
        )
          throw new DemoError(
            'Demo identity collision; refusing to adopt an existing account.',
          );
        if (!found) {
          const result = await admin.auth.admin.createUser({
            email: account.email,
            password: account.password,
            email_confirm: true,
            app_metadata: {
              demo_seed: 'swapcircle-v1',
              ...(hosted
                ? { demo_target: status.API_URL, demo_ready: false }
                : {}),
            },
          });
          if (result.error || !result.data.user)
            throw new DemoError('Demo account creation failed.');
          found = result.data.user;
        }
        account.id = found.id;
        await writePrivate(credentialsPath, credentials);
      }
      const client = createClient(status.API_URL, status.ANON_KEY, authOptions);
      const login = await client.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (
        login.error ||
        !login.data.session ||
        login.data.user.id !== account.id ||
        login.data.user.app_metadata.demo_seed !== 'swapcircle-v1' ||
        (hosted && login.data.user.app_metadata.demo_target !== status.API_URL)
      )
        throw new DemoError('Demo identity changed; refusing to replace it.');
      actors.set(member.key, {
        id: account.id,
        token: login.data.session.access_token,
        client,
      });
    }

    const catalogue = await request(
      null,
      '/interests',
      interestCatalogueSchema,
    );
    for (const [index, member] of members.entries()) {
      const input = {
        displayName: member.name,
        biography: member.bio,
        approximateLocation: member.location,
        interestIds: member.interests.map((name) => {
          const interest = catalogue.find((interest) => interest.name === name);
          if (!interest)
            throw new DemoError('An interest is missing from the catalogue.');
          return interest.id;
        }),
      };
      await journal.step(
        `profile/${member.key}`,
        input,
        profileSchema,
        async () => {
          const current = await request(
            member.key,
            '/profiles/me',
            profileSchema,
          );
          if (
            current.displayName === input.displayName &&
            current.biography === input.biography &&
            current.approximateLocation === input.approximateLocation
          )
            return current;
          if (
            current.biography ||
            current.approximateLocation ||
            current.interests.length
          )
            throw new DemoError(
              'A demo profile was edited; refusing to overwrite it.',
            );
          return request(
            member.key,
            '/profiles/me',
            profileSchema,
            input,
            'PUT',
          );
        },
      );
      await journal.step(
        `avatar/${member.key}`,
        { asset: `avatar-${index}` },
        profileSchema,
        async () => {
          const current = await request(
            member.key,
            '/profiles/me',
            profileSchema,
          );
          if (current.avatarUrl) return current;
          return request(
            member.key,
            '/profiles/me/avatar',
            profileSchema,
            undefined,
            'POST',
            await readFile(new URL(`avatar-${index}.jpg`, assetRoot)),
          );
        },
      );
    }

    const savedListings = new Map<string, z.infer<typeof listingSchema>>();
    for (const item of listings) {
      const { key, owner, images, ...input } = item;
      const saved = await journal.step(
        `listing/${key}`,
        input,
        listingSchema,
        async () => {
          const existing = await request(
            owner,
            '/listings/mine?limit=50',
            listingPageSchema,
          );
          const record = journal.state.steps[`listing/${key}`]!;
          if (record.beforeIds) {
            const newItems = existing.items.filter(
              (entry) => !record.beforeIds!.includes(entry.id),
            );
            if (
              newItems.some(
                (entry) =>
                  entry.title !== input.title ||
                  entry.description !== input.description,
              )
            ) {
              throw new DemoError(
                'A listing changed during an interrupted seed; refusing to recreate or overwrite it.',
              );
            }
          } else {
            record.beforeIds = existing.items.map((entry) => entry.id);
            await journal.checkpoint();
          }
          const matches = existing.items.filter(
            (listing) =>
              listing.title === input.title &&
              listing.description === input.description,
          );
          if (matches.length > 1)
            throw new DemoError(
              'Duplicate demo listing detected; refusing to add another.',
            );
          if (matches.length === 1) return matches[0]!;
          return request(owner, '/listings', listingSchema, input);
        },
      );
      savedListings.set(key, saved);
      for (const [position, asset] of images.entries())
        await journal.step(
          `photo/${key}/${position}`,
          { asset, listingId: saved.id },
          listingPhotosSchema,
          async () => {
            const current = await request(
              null,
              `/listings/${saved.id}/photos`,
              listingPhotosSchema,
            );
            if (current.length > position) return current;
            const listing = await request(
              null,
              `/listings/${saved.id}`,
              listingSchema,
            );
            if (
              listing.revision !== saved.revision ||
              listing.availability !== 'available'
            )
              throw new DemoError(
                'A demo listing changed; refusing to modify its photos.',
              );
            await request(
              owner,
              `/listings/${saved.id}/photos`,
              listingPhotosSchema.element,
              undefined,
              'POST',
              await readFile(new URL(`${asset}.jpg`, assetRoot)),
            );
            return request(
              null,
              `/listings/${saved.id}/photos`,
              listingPhotosSchema,
            );
          },
        );
    }

    for (const swap of swaps) {
      const spec = swap as {
        key: string;
        creator: MemberKey;
        items: readonly string[];
        status: string;
        coffee?: string;
        meeting?: string;
        chat?: string;
      };
      const items = spec.items.map((key) =>
        listings.find((item) => item.key === key)!,
      );
      const owners = items.map((item) => item.owner);
      const input = {
        participantIds: owners.map((key) => actors.get(key)!.id),
        transfers: items.map((item, index) => ({
          listingId: savedListings.get(item.key)!.id,
          ownerId: actors.get(item.owner)!.id,
          recipientId: actors.get(owners[(index + 1) % owners.length]!)!.id,
        })),
        meetingMode: 'meet_to_swap',
        expiresAt: new Date(
          Date.parse(journal.state.startedAt) + 28 * 86400_000,
        ).toISOString(),
      };
      const proposal = await journal.step(
        `trade/${spec.key}`,
        input,
        proposalCreationResultSchema,
        (operationKey) =>
          request(spec.creator, '/trades', proposalCreationResultSchema, {
            ...input,
            operationKey,
          }),
      );
      const id = proposal.id;

      if (spec.chat && owners.length > 2) {
        const detail = await request(
          spec.creator,
          `/trades/${id}`,
          tradeDetailSchema,
        );
        const conversationId = detail.groupConversationId;
        if (!conversationId) throw new DemoError('Missing group conversation.');
        const groupOwners =
          spec.chat === 'pending'
            ? owners.filter((owner) => owner !== 'guest')
            : owners;
        for (const owner of groupOwners) {
          if (owner === spec.creator) continue;
          await journal.step(
            `join/${spec.key}/${owner}`,
            { conversationId },
            z.unknown(),
            () =>
              request(
                owner,
                `/conversations/${conversationId}/invitation/accept`,
                z.unknown(),
                {},
                'PUT',
              ),
          );
        }
        if (spec.chat === 'accepted') {
          const messages = [
            'Glad we found a swap that works for all three of us!',
            'I have checked my item and it matches the listing. Happy to answer questions.',
            'Thanks! Let us keep the handover plan here so everyone has the same details.',
          ];
          for (const [index, owner] of owners.entries())
            await journal.step(
              `group-message/${spec.key}/${index}`,
              { conversationId, body: messages[index] },
              messageReceiptSchema,
              (operationKey) =>
                request(
                  owner,
                  '/conversations/messages',
                  messageReceiptSchema,
                  {
                    conversation_id: conversationId,
                    body: messages[index],
                    client_message_id: operationKey,
                  },
                ),
            );
        }
      }

      if (['confirmed', 'completed', 'disputed'].includes(spec.status))
        for (const owner of owners)
          await journal.step(
            `accept/${spec.key}/${owner}`,
            { id },
            tradeAcceptanceResultSchema,
            (operationKey) =>
              request(
                owner,
                `/trades/${id}/accept`,
                tradeAcceptanceResultSchema,
                { expectedVersion: 1, operationKey },
              ),
          );

      if (spec.coffee) {
        const inviter: MemberKey =
          spec.key === 'incoming-camera' ? 'noah' : 'guest';
        const invitee: MemberKey = inviter === 'guest' ? 'lea' : 'guest';
        const coffee = await journal.step(
          `coffee/${spec.key}`,
          { id, invitee },
          coffeeInvitationSchema,
          (operationKey) =>
            request(inviter, `/trades/${id}/coffee`, coffeeInvitationSchema, {
              inviteeId: actors.get(invitee)!.id,
              operationKey,
              offerToPay: spec.coffee === 'accepted',
            }),
        );
        if (spec.coffee === 'accepted')
          await journal.step(
            `coffee-accept/${spec.key}`,
            { id, coffeeId: coffee.id },
            coffeeInvitationSchema,
            async () => {
              const current = await request(
                invitee,
                `/coffee/${coffee.id}`,
                coffeeInvitationSchema,
              );
              if (current.status === 'accepted') return current;
              return request(
                invitee,
                `/trades/${id}/coffee/${coffee.id}/respond`,
                coffeeInvitationSchema,
                { action: 'accept' },
              );
            },
          );
      }

      if (spec.meeting) {
        const meetingInput = {
          expectedTradeVersion: 1,
          place: 'Fictional demo café · Paris',
          mapLink: null,
          meetingAt: new Date(
            Date.parse(journal.state.startedAt) + 7 * 86400_000,
          ).toISOString(),
          timeZone: 'Europe/Paris',
        };
        const meeting = await journal.step(
          `meeting/${spec.key}`,
          { id, ...meetingInput },
          meetupSchema,
          (operationKey) =>
            request(spec.creator, `/trades/${id}/meeting`, meetupSchema, {
              ...meetingInput,
              operationKey,
            }),
        );
        if (spec.meeting === 'confirmed')
          for (const owner of owners)
            await journal.step(
              `meeting-confirm/${spec.key}/${owner}`,
              { id, revision: meeting.revision },
              meetupSchema,
              async (operationKey) => {
                const current = await request(
                  owner,
                  `/trades/${id}/meeting`,
                  meetupSchema,
                );
                const previous =
                  current.responses.find(
                    (entry) => entry.userId === actors.get(owner)!.id,
                  )?.response ?? null;
                if (previous === 'confirmed') return current;
                return request(
                  owner,
                  `/trades/${id}/meeting/respond`,
                  meetupSchema,
                  {
                    expectedTradeVersion: 1,
                    expectedRevision: meeting.revision,
                    expectedResponse: previous,
                    response: 'confirmed',
                    operationKey,
                  },
                );
              },
            );
      }

      if (spec.status === 'cancelled')
        await journal.step(
          `cancel/${spec.key}`,
          { id },
          tradeTransitionResultSchema,
          async () => {
            const current = await request(
              spec.creator,
              `/trades/${id}`,
              tradeDetailSchema,
            );
            if (current.status === 'cancelled')
              return { id, currentVersion: 1, status: 'cancelled' as const };
            return request(
              spec.creator,
              `/trades/${id}/cancel`,
              tradeTransitionResultSchema,
              { expectedVersion: 1, expectedStatus: 'proposed' },
            );
          },
        );
      if (spec.status === 'completed')
        for (const owner of owners)
          await journal.step(
            `receipt/${spec.key}/${owner}`,
            { id },
            tradeOutcomeResultSchema,
            (operationKey) =>
              request(
                owner,
                `/trades/${id}/receipt`,
                tradeOutcomeResultSchema,
                { expectedVersion: 1, operationKey },
              ),
          );
      if (spec.status === 'disputed')
        await journal.step(
          `dispute/${spec.key}`,
          { id },
          tradeOutcomeResultSchema,
          (operationKey) =>
            request(
              'guest',
              `/trades/${id}/problem`,
              tradeOutcomeResultSchema,
              {
                expectedVersion: 1,
                operationKey,
                kind: 'problem',
                reason:
                  'Fictional demonstration: an item needs inspection before the exchange can be resolved.',
              },
            ),
        );
    }

    const chats: [MemberKey, string[]][] = [
      [
        'lea',
        [
          'Your balcony plants look lovely. Would you be interested in a cactus?',
          'Yes! I have been looking for a sunny windowsill companion.',
          'Great, the proposal has the details of both plants.',
          'Perfect. I am happy to meet for a coffee as well.',
        ],
      ],
      [
        'noah',
        [
          'I noticed your camera kit. I have an instant camera I could offer.',
          'That sounds fun. Does it come with any film?',
          'No film included, but I have described everything in the listing.',
          'Thanks for being clear. I will take a look at your proposal.',
        ],
      ],
      [
        'ines',
        [
          'Have you played this board game with three people?',
          'Yes, that is a nice group size. We often play it on Sunday afternoons.',
          'Good to know! I like the idea of giving games another home.',
          'Same here. Happy to explain the rules if you decide to swap.',
        ],
      ],
      [
        'sarah',
        [
          'Thanks for considering the guitar exchange.',
          'Thank you too. I think I will wait until I have more room at home.',
          'No problem, I have cancelled the proposal. Happy browsing!',
          'That works. Perhaps we will find another swap later.',
        ],
      ],
      [
        'eli',
        [
          'Hope you enjoy the books!',
          'Already started one. Thank you for the thoughtful swap.',
          'The vintage collection looks great on my shelf.',
          'Lovely to hear. See you around the neighbourhood!',
        ],
      ],
    ];
    for (const [other, texts] of chats) {
      const conversation = await journal.step(
        `direct/${other}`,
        { otherId: actors.get(other)!.id },
        directConversationReceiptSchema,
        () =>
          request(
            'guest',
            '/conversations/direct',
            directConversationReceiptSchema,
            { userId: actors.get(other)!.id },
          ),
      );
      for (const [index, body] of texts.entries()) {
        const sender = index % 2 === 0 ? 'guest' : other;
        const message = await journal.step(
          `direct-message/${other}/${index}`,
          { conversationId: conversation.id, body },
          messageReceiptSchema,
          (operationKey) =>
            request(sender, '/conversations/messages', messageReceiptSchema, {
              conversation_id: conversation.id,
              body,
              client_message_id: operationKey,
            }),
        );
        if (index === 2 && ['lea', 'eli'].includes(other))
          await journal.step(
            `read/${other}`,
            { id: message.id },
            z.unknown(),
            () =>
              request(
                'guest',
                '/conversations/read',
                z.unknown(),
                { conversation_id: conversation.id, message_id: message.id },
                'PUT',
              ),
          );
      }
    }
    await journal.step('notifications/read', {}, z.unknown(), async () => {
      const { data, error } = await actors
        .get('guest')!
        .client.from('notifications')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(3);
      if (error || !data?.length)
        throw new DemoError('Notifications unavailable.');
      return request(
        'guest',
        '/notifications/read-all',
        z.unknown(),
        { notification_ids: data.map((notification) => notification.id) },
        'PUT',
      );
    });

    let changed = 0;
    for (const item of listings) {
      const actual = await request(
        null,
        `/listings/${savedListings.get(item.key)!.id}`,
        listingSchema,
      );
      if (
        actual.title !== item.title ||
        actual.description !== item.description
      )
        changed++;
      const photos = await request(
        null,
        `/listings/${actual.id}/photos`,
        listingPhotosSchema,
      );
      if (!photos.length) throw new DemoError('A demo listing has no photos.');
      for (const photo of photos) {
        const target = new URL(photo.url);
        if (target.origin !== status.API_URL)
          throw new DemoError('Unexpected photo target.');
        const response = await fetch(photo.url, {
          signal: AbortSignal.timeout(10_000),
        });
        if (
          !response.ok ||
          !response.headers.get('Content-Type')?.startsWith('image/')
        )
          throw new DemoError('Demo image unavailable.');
      }
    }
    if (hosted) {
      await hostedReadiness(process.env);
      await hostedInventory(
        process.env,
        new URL('baseline.json', directory),
        true,
      );
      const guest = credentials.accounts.find(
        (account) => account.key === 'guest',
      )!;
      const result = await admin.auth.admin.updateUserById(guest.id!, {
        app_metadata: {
          demo_seed: 'swapcircle-v1',
          demo_target: status.API_URL,
          demo_ready: true,
        },
      });
      if (result.error)
        throw new DemoError('Hosted guest readiness could not be published.');
      await writePrivate(new URL('guest.json', directory), {
        id: guest.id,
        email: guest.email,
        password: guest.password,
      });
    }
    await writePrivate(new URL('ready.json', directory), {
      version: 1,
      guestId: actors.get('guest')!.id,
    });
    console.info(
      `${hosted ? 'Production' : 'Development'} demo ready: ${members.length} members, ${listings.length} illustrated listings, ${swaps.length} swaps, 5 direct chats and 2 populated group chats. ${changed} edited listings preserved.`,
    );
    console.info(
      `Private form-login credentials: packages/database/${hosted ? '.demo.hosted.local' : '.demo.local'}/credentials.json. No credentials were printed.`,
    );
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool?.end();
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof DemoError
      ? error.message
      : 'Demo stopped safely. Check the approved target and ignored demo journal; no credentials were logged.',
  );
  process.exitCode = 1;
});
