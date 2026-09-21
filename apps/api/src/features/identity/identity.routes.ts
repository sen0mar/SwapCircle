import { Router } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import { getIdentity } from './identity.controller.js';

export function createIdentityRouter(verifyToken: VerifyToken): Router {
  const router = Router();

  router.get('/identity', authenticate(verifyToken), getIdentity);

  return router;
}
