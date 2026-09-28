import {
  emptyResponseSchema,
  blockPageSchema,
  reportReceiptSchema,
  safetyStatusSchema,
  type ReportSubmission,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export function getSafetyStatus(
  request: typeof apiRequest,
  signal: AbortSignal,
  userId?: string,
) {
  return request(
    `/api/v1/safety/status${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`,
    safetyStatusSchema,
    { signal },
  );
}

export function getBlocks(
  request: typeof apiRequest,
  signal: AbortSignal,
  after?: string,
) {
  return request(
    `/api/v1/safety/blocks${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    blockPageSchema,
    { signal },
  );
}

export function setBlock(
  request: typeof apiRequest,
  userId: string,
  blocked: boolean,
) {
  return request(
    blocked
      ? '/api/v1/safety/blocks'
      : `/api/v1/safety/blocks/${encodeURIComponent(userId)}`,
    emptyResponseSchema,
    {
      method: blocked ? 'PUT' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      ...(blocked ? { body: JSON.stringify({ userId }) } : {}),
    },
  );
}

export function submitReport(
  request: typeof apiRequest,
  input: ReportSubmission,
) {
  return request('/api/v1/safety/reports', reportReceiptSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
