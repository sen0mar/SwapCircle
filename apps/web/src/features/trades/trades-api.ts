import {
  proposalCreationResultSchema,
  tradeDetailSchema,
  tradePageSchema,
  type ProposalCreation,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export function createTrade(
  request: typeof apiRequest,
  input: ProposalCreation,
) {
  return request('/api/v1/trades', proposalCreationResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getMyTrades(
  request: typeof apiRequest,
  after: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ limit: '20' });
  if (after) query.set('after', after);

  return request(`/api/v1/trades/mine?${query}`, tradePageSchema, { signal });
}

export function getTrade(
  request: typeof apiRequest,
  id: string,
  signal: AbortSignal,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(id)}`,
    tradeDetailSchema,
    { signal },
  );
}
