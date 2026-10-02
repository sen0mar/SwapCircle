import {
  meetupSchema,
  type MeetingCreate,
  type MeetingUpdate,
  type MeetingResponse,
} from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export type MeetingAction =
  | { kind: 'create'; input: MeetingCreate }
  | { kind: 'update'; input: MeetingUpdate }
  | { kind: 'respond'; input: MeetingResponse };

export function getMeeting(
  request: typeof apiRequest,
  id: string,
  signal: AbortSignal,
  byTrade = true,
) {
  return request(
    byTrade
      ? `/api/v1/trades/${encodeURIComponent(id)}/meeting`
      : `/api/v1/meetups/${encodeURIComponent(id)}`,
    meetupSchema.nullable(),
    { signal },
  );
}

export function saveMeeting(
  request: typeof apiRequest,
  id: string,
  action: MeetingAction,
) {
  return request(
    `/api/v1/trades/${encodeURIComponent(id)}/meeting${action.kind === 'respond' ? '/respond' : ''}`,
    meetupSchema,
    {
      method: action.kind === 'update' ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.input),
    },
  );
}
