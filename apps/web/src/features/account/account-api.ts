import { identitySchema } from '@swapcircle/contracts';
import type { apiRequest } from '../../lib/api-client';

export function getIdentity(request: typeof apiRequest, signal: AbortSignal) {
  return request('/api/v1/identity', identitySchema, { signal });
}
