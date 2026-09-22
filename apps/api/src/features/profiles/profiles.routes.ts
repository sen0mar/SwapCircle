import { Router } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import { createProfilesController } from './profiles.controller.js';
import type { ProfilesService } from './profiles.service.js';

export function createProfilesRouter(
  verifyToken: VerifyToken,
  service: ProfilesService,
): Router {
  const router = Router();
  const controller = createProfilesController(service);

  router.get('/profiles/me', authenticate(verifyToken), controller.current);
  router.put('/profiles/me', authenticate(verifyToken), controller.update);
  router.get('/interests', controller.interests);
  router.get('/members/:id', controller.publicProfile);

  return router;
}
