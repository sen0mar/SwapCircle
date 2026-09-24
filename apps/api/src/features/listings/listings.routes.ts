import { Router } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import { createListingsController } from './listings.controller.js';
import type { ListingsService } from './listings.service.js';

export function createListingsRouter(
  verifyToken: VerifyToken,
  service: ListingsService,
): Router {
  const router = Router();
  const controller = createListingsController(service);

  router.get('/listings', controller.page);
  router.get('/listings/mine', authenticate(verifyToken), controller.mine);
  router.get('/listings/:id', controller.detail);
  router.post('/listings', authenticate(verifyToken), controller.create);
  router.put('/listings/:id', authenticate(verifyToken), controller.edit);
  router.post(
    '/listings/:id/withdraw',
    authenticate(verifyToken),
    controller.withdraw,
  );
  return router;
}
