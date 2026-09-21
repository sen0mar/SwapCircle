import { Router } from 'express';
import type { VerifyToken } from './auth/verify.js';
import { createHealthRouter } from './features/health/health.routes.js';
import { createIdentityRouter } from './features/identity/identity.routes.js';

export function createApiRouter(verifyToken: VerifyToken): Router {
  const api = Router();
  api.use(createHealthRouter());
  api.use(createIdentityRouter(verifyToken));
  return api;
}
