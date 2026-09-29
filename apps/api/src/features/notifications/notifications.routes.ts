import { Router } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import type { NotificationsService } from './notifications.service.js';
import { createNotificationsController } from './notifications.controller.js';

export function createNotificationsRouter(
  verifyToken: VerifyToken,
  service: NotificationsService,
): Router {
  const router = Router();
  const controller = createNotificationsController(service);

  router.put(
    '/notifications/read',
    authenticate(verifyToken),
    controller.markRead,
  );
  router.put(
    '/notifications/read-all',
    authenticate(verifyToken),
    controller.markAllRead,
  );

  return router;
}
