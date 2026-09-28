import { expect, test } from 'vitest';
import { ApiError } from '../src/lib/api-client';
import { actionError } from '../src/features/safety/action-error';
import { apiRequest } from '../src/lib/api-client';
import { emptyResponseSchema } from '@swapcircle/contracts';
import { vi } from 'vitest';

test.each([
  'ACTION_LIMIT',
  'BURST_LIMIT',
  'CONTACT_BLOCKED',
  'ACCOUNT_RESTRICTED',
  'REPORT_RETRY_CONFLICT',
  'NETWORK_ERROR',
  'TIMEOUT',
])('safe recovery for %s does not expose server details', (code) => {
  const message = actionError(new ApiError('INTERNAL_PRIVATE_REASON', code));
  expect(message).not.toContain('INTERNAL_PRIVATE_REASON');
  expect(message.length).toBeGreaterThan(40);
});

test('successful bodyless safety writes are accepted without a JSON parse', async () => {
  const json = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ status: 204, ok: true, json }),
  );
  try {
    expect(
      await apiRequest('/api/v1/safety/blocks', emptyResponseSchema, {
        method: 'PUT',
      }),
    ).toBeNull();
    expect(json).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
