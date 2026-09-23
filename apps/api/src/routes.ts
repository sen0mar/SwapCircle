import { createListingsRouter } from './features/listings/listings.routes.js';
import type { ListingsService } from './features/listings/listings.service.js';
import { Router } from 'express';
import type { VerifyToken } from './auth/verify.js';
import { createHealthRouter } from './features/health/health.routes.js';
import { createIdentityRouter } from './features/identity/identity.routes.js';
import { createProfilesRouter } from './features/profiles/profiles.routes.js';
import type { ProfilesService } from './features/profiles/profiles.service.js';

export function createApiRouter(
  verifyToken: VerifyToken,
  profiles?: ProfilesService,
  listings?: ListingsService,
): Router {
  const api = Router();

  api.use(createHealthRouter());
  api.use(createIdentityRouter(verifyToken));

  if (profiles) api.use(createProfilesRouter(verifyToken, profiles));

  if (listings) api.use(createListingsRouter(verifyToken, listings));

  return api;
}
