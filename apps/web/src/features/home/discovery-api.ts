import { memberPageSchema, type MemberQuery } from '@swapcircle/contracts';
import { apiRequest } from '../../lib/api-client';

export function getMembers(
  query: MemberQuery,
  personalized: boolean,
  request: typeof apiRequest,
  signal: AbortSignal,
) {
  const search = new URLSearchParams({ limit: String(query.limit) });

  if (query.interest) search.set('interest', query.interest);
  if (query.cursor) search.set('cursor', query.cursor);

  return request(
    `/api/v1/members${personalized ? '/discovery' : ''}?${search}`,
    memberPageSchema,
    { signal },
  );
}
