import { expect, test } from 'vitest';
import { safeDestination } from '../src/features/auth/safe-destination';

const id = '12345678-1234-4234-8234-123456789012';
test('sign-in returns to implemented shelf, swap and listing flows', () => {
  for (const destination of [
    '/shelf',
    '/swaps',
    `/swaps/${id}`,
    '/listings/new',
    `/listings/${id}`,
    `/listings/${id}/edit`,
    `/browse?q=books#catalog-search`,
  ])
    expect(safeDestination(destination)).toBe(destination);
});
test('demo login preserves redirect protection against external and unknown destinations', () => {
  for (const destination of [
    'https://evil.invalid',
    '//evil.invalid',
    '/\\evil.invalid',
    '/admin',
    '/swaps/not-an-id',
    '/listings/not-an-id/edit',
    '/shelf /anything',
  ])
    expect(safeDestination(destination)).toBe('/account');
});
