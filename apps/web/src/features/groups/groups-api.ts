import {
  groupInvitationSchema,
  groupMembershipReceiptSchema,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export function getGroup(
  request: typeof apiRequest,
  id: string,
  signal: AbortSignal,
) {
  return request(
    `/api/v1/conversations/${encodeURIComponent(id)}/invitation`,
    groupInvitationSchema,
    { signal },
  );
}

export function respondGroup(
  request: typeof apiRequest,
  id: string,
  action: 'accept' | 'decline' | 'leave',
) {
  const path = action === 'leave' ? 'leave' : `invitation/${action}`;

  return request(
    `/api/v1/conversations/${encodeURIComponent(id)}/${path}`,
    groupMembershipReceiptSchema,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
}
