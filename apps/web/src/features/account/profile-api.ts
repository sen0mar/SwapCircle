import {
  currentProfileSchema,
  interestCatalogueSchema,
  publicProfileSchema,
  type ProfileUpdate,
} from '@swapcircle/contracts';
import { apiRequest } from '../../lib/api-client';

export function getCurrentProfile(
  request: typeof apiRequest,
  signal: AbortSignal,
) {
  return request('/api/v1/profiles/me', currentProfileSchema, { signal });
}

export function saveCurrentProfile(
  request: typeof apiRequest,
  update: ProfileUpdate,
) {
  return request('/api/v1/profiles/me', currentProfileSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
}

export function getInterests(signal: AbortSignal) {
  return apiRequest('/api/v1/interests', interestCatalogueSchema, { signal });
}

export function getPublicProfile(id: string, signal: AbortSignal) {
  return apiRequest(`/api/v1/members/${id}`, publicProfileSchema, { signal });
}
