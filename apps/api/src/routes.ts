import { Router } from 'express';
import type { VerifyToken } from './auth/verify.js';
import { createHealthRouter } from './features/health/health.routes.js';
import { createIdentityRouter } from './features/identity/identity.routes.js';
import { createProfilesRouter } from './features/profiles/profiles.routes.js';
import type { ProfilesService } from './features/profiles/profiles.service.js';

export function createApiRouter(
  verifyToken: VerifyToken,
  profiles?: ProfilesService,
): Router {
  const api = Router();

  api.use(createHealthRouter());
  api.use(createIdentityRouter(verifyToken));

  if (profiles) api.use(createProfilesRouter(verifyToken, profiles));

  return api;
}
