import { Router } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import type { SafetyService } from './safety.service.js';
import { createSafetyController } from './safety.controller.js';

export function createSafetyRouter(
  verifyToken: VerifyToken,
  service: SafetyService,
): Router {
  const router = Router();
  const controller = createSafetyController(service);

  router.use('/safety', authenticate(verifyToken));
  router.get('/safety/blocks', controller.ownBlocks);
  router.put('/safety/blocks', controller.block);
  router.delete('/safety/blocks/:userId', controller.unblock);
  router.post('/safety/reports', controller.report);

  return router;
}
