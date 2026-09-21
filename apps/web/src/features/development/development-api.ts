import { livenessSchema } from '@swapcircle/contracts';
import { apiRequest } from '../../lib/api-client';

export function getApiStatus(signal: AbortSignal) {
  return apiRequest('/api/v1/live', livenessSchema, { signal });
}
