import {
  coffeeEligibilitySchema,
  coffeeInvitationListSchema,
  coffeeInvitationSchema,
  type CoffeeSend,
  type CoffeeResponse,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export type CoffeeAction =
  { send: CoffeeSend } | { id: string; action: CoffeeResponse['action'] };

export function getCoffee(
  request: typeof apiRequest,
  tradeId: string,
  signal: AbortSignal,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(tradeId)}/coffee`,
    coffeeInvitationListSchema,
    { signal },
  );
}

export function getCoffeeEligibility(
  request: typeof apiRequest,
  tradeId: string,
  inviteeId: string,
  signal: AbortSignal,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(tradeId)}/coffee/eligibility?${new URLSearchParams({ inviteeId })}`,
    coffeeEligibilitySchema,
    { signal },
  );
}

export function saveCoffeeAction(
  request: typeof apiRequest,
  tradeId: string,
  input: CoffeeAction,
) {
  return request(
    'send' in input
      ? `/api/v1/trades/${encodeURIComponent(tradeId)}/coffee`
      : `/api/v1/trades/${encodeURIComponent(tradeId)}/coffee/${encodeURIComponent(input.id)}/respond`,
    coffeeInvitationSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        'send' in input ? input.send : { action: input.action },
      ),
    },
  );
}

export function getCoffeeInvitation(
  request: typeof apiRequest,
  id: string,
  signal: AbortSignal,
) {
  return request(
    `/api/v1/coffee/${encodeURIComponent(id)}`,
    coffeeInvitationSchema,
    { signal },
  );
}
