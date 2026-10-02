import {
  tradeAcceptanceResultSchema,
  type TradeAcceptance,
  proposalCreationResultSchema,
  tradeDetailSchema,
  tradePageSchema,
  type ProposalCreation,
  type ProposalRevision,
  tradeVersionSchema,
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

export type TradeDetail = Awaited<ReturnType<typeof getTrade>>;
export type TradeVersion = Awaited<ReturnType<typeof getTradeVersion>>;

export function reviseTrade(
  request: typeof apiRequest,
  id: string,
  input: ProposalRevision,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(id)}`,
    proposalCreationResultSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function getTradeVersion(
  request: typeof apiRequest,
  id: string,
  version: number,
  signal: AbortSignal,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(id)}/versions/${version}`,
    tradeVersionSchema,
    { signal },
  );
}

export function acceptTrade(
  request: typeof apiRequest,
  id: string,
  input: TradeAcceptance,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(id)}/accept`,
    tradeAcceptanceResultSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}
