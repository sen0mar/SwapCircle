import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { ListingsRepository } from '../src/features/listings/listings.repository.js';
import { ListingsService } from '../src/features/listings/listings.service.js';
import {
  catalogQuerySchema,
  type Listing,
  type CatalogQuery,
  type ListingCursor,
  apiErrorSchema,
  listingCreateSchema,
  listingUpdateSchema,
} from '@swapcircle/contracts';

// No connection is configured: rejected requests must never reach persistence.
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => '5c56caec-2d79-4d5d-920c-35e90dc476bf',
  listings: new ListingsService(new ListingsRepository(new Pool())),
});
const data = {
  title: 'Book',
  description: 'A synthetic book',
  condition: 'good',
};

test('listing writes reject missing authentication before persistence', async () => {
  for (const [method, path] of [
    ['post', '/listings'],
    ['put', '/listings/id'],
    ['post', '/listings/id/withdraw'],
  ] as const) {
    const pending = request(app)[method](`/api/v1${path}`);

    const result = await pending.send(data).expect(401);
    apiErrorSchema.parse(result.body);
  }
});

test('My Shelf requires authentication before persistence', async () => {
  const result = await request(app).get('/api/v1/listings/mine').expect(401);
  apiErrorSchema.parse(result.body);
});

test('My Shelf rejects owner and cursor query injection', async () => {
  for (const query of [{ ownerId: 'forged' }, { cursor: 'invalid' }]) {
    const result = await request(app)
      .get('/api/v1/listings/mine')
      .set('Authorization', 'Bearer synthetic')
      .query(query)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
});

test('listing contracts reject ownership, state and revision injection', () => {
  assert.equal(listingCreateSchema.safeParse(data).success, true);
  for (const extra of [
    { ownerId: 'someone' },
    { availability: 'reserved' },
    { revision: 2 },
    { createdAt: 'today' },
  ]) {
    assert.equal(
      listingCreateSchema.safeParse({ ...data, ...extra }).success,
      false,
    );
  }
  assert.equal(listingUpdateSchema.safeParse(data).success, false);
  assert.equal(
    listingUpdateSchema.safeParse({ ...data, revision: 0 }).success,
    false,
  );
});

test('invalid listing and cursor inputs produce safe errors before persistence', async () => {
  for (const body of [
    { ...data, ownerId: 'forged' },
    { ...data, title: '' },
    { ...data, condition: 'invalid' },
  ]) {
    const result = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', 'Bearer synthetic')
      .send(body)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
  for (const query of [
    { limit: 51 },
    { limit: -1 },
    { cursor: 'invalid' },
    { cursor: Buffer.from('{}').toString('base64url') },
  ]) {
    const result = await request(app)
      .get('/api/v1/listings')
      .query(query)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
});

test('catalog pagination returns adjacent pages in either sort order with exact timestamp cursors', async () => {
  const records: Listing[] = Array.from({ length: 5 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    ownerId: '5c56caec-2d79-4d5d-920c-35e90dc476bf',
    title: `Book ${index}`,
    description: '',
    condition: 'good',
    availability: 'available',
    revision: 1,
    createdAt: '2026-09-01T12:00:00.123456Z',
    updatedAt: '2026-09-01T12:00:00.123456Z',
  }));

  class MemoryListings extends ListingsRepository {
    override async page(query: CatalogQuery, cursor?: ListingCursor) {
      const ascending =
        (query.sort === 'oldest') !== (query.direction === 'previous');
      const rows = records.filter(
        (record) =>
          !cursor ||
          (ascending ? record.id > cursor.id : record.id < cursor.id),
      );
      rows.sort((left, right) =>
        ascending
          ? left.id.localeCompare(right.id)
          : right.id.localeCompare(left.id),
      );
      return rows.slice(0, query.limit + 1);
    }

    override async pagination(query: CatalogQuery, first?: ListingCursor) {
      const preceding = records.filter(
        (record) =>
          first &&
          (query.sort === 'oldest'
            ? record.id < first.id
            : record.id > first.id),
      ).length;
      return {
        page: Math.floor(preceding / query.limit) + 1,
        totalPages: Math.max(1, Math.ceil(records.length / query.limit)),
      };
    }

    override async lastPage(query: CatalogQuery) {
      const ordered = [...records].sort((left, right) =>
        query.sort === 'oldest'
          ? left.id.localeCompare(right.id)
          : right.id.localeCompare(left.id),
      );
      const offset = ordered.length
        ? Math.floor((ordered.length - 1) / query.limit) * query.limit
        : 0;
      return { items: ordered.slice(offset), hasPrevious: offset > 0 };
    }
  }

  const service = new ListingsService(new MemoryListings(new Pool()));
  const decode = (value: string | null) => {
    assert.ok(value);
    return JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as ListingCursor;
  };

  for (const sort of ['oldest', 'newest'] as const) {
    const query = catalogQuerySchema.parse({ limit: 2, sort });
    const first = await service.page(query);
    assert.equal(first.previousCursor, null);
    assert.equal(first.page, 1);
    assert.equal(first.totalPages, 3);
    const second = await service.page(query, decode(first.nextCursor));
    const third = await service.page(query, decode(second.nextCursor));
    assert.equal(third.nextCursor, null);
    const last = await service.page({ ...query, direction: 'last' });
    assert.deepEqual(last.items, third.items);
    assert.equal(last.items.length, 1);
    assert.equal(last.page, 3);

    assert.equal(last.nextCursor, null);
    assert.ok(last.previousCursor);
    const back = await service.page(
      { ...query, direction: 'previous' },
      decode(third.previousCursor),
    );
    assert.deepEqual(back.items, second.items);
    assert.equal(decode(back.nextCursor).createdAt, records[0]!.createdAt);
    const start = await service.page(
      { ...query, direction: 'previous' },
      decode(back.previousCursor),
    );
    assert.deepEqual(start.items, first.items);
    assert.equal(start.previousCursor, null);
    assert.deepEqual(
      (await service.page(query, decode(start.nextCursor))).items,
      second.items,
    );
  }
});

test('catalog repository reverses keyset comparison and ordering for previous pages', async () => {
  const pool = new Pool();
  const querySpy = vi.spyOn(pool, 'query').mockImplementation(async () => ({
    rows: [],
    command: 'SELECT',
    rowCount: 0,
    oid: 0,
    fields: [],
  }));
  const repository = new ListingsRepository(pool);
  const cursor = {
    id: '00000000-0000-4000-8000-000000000003',
    createdAt: '2026-09-01T12:00:00.123456Z',
  };

  for (const sort of ['oldest', 'newest'] as const) {
    for (const direction of ['next', 'previous'] as const) {
      await repository.page(
        catalogQuerySchema.parse({
          sort,
          direction,
          limit: 2,
          q: 'garden',
          condition: 'good',
        }),
        cursor,
      );
      const [sql, values] = querySpy.mock.calls.at(-1)!;
      const ascending = (sort === 'oldest') !== (direction === 'previous');
      assert.ok(
        String(sql).includes(`(created_at, id) ${ascending ? '>' : '<'} ($2`),
      );
      assert.ok(
        String(sql).includes(
          `ORDER BY created_at ${ascending ? 'ASC' : 'DESC'}, id ${ascending ? 'ASC' : 'DESC'}`,
        ),
      );
      assert.deepEqual(values, [
        3,
        cursor.createdAt,
        cursor.id,
        'available',
        'good',
        'garden',
        null,
      ]);
    }
  }
  for (const sort of ['oldest', 'newest'] as const) {
    const result = await repository.lastPage(
      catalogQuerySchema.parse({
        sort,
        limit: 2,
        q: 'garden',
        condition: 'good',
      }),
    );
    assert.deepEqual(result, { items: [], hasPrevious: false });
    const [sql, values] = querySpy.mock.calls.at(-1)!;
    assert.ok(
      String(sql).includes('((count(*) - 1) / $1::bigint) * $1::bigint'),
    );
    assert.ok(
      String(sql).includes(
        `ORDER BY created_at ${sort === 'oldest' ? 'ASC' : 'DESC'}`,
      ),
    );
    assert.deepEqual(values, [2, 'available', 'good', 'garden', null]);
  }
  querySpy.mockRestore();
  await pool.end();
});
