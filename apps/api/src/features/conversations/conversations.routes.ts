import { Router } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import type { ConversationsService } from './conversations.service.js';
import { createConversationsController } from './conversations.controller.js';

export function createConversationsRouter(
  verifyToken: VerifyToken,
  service: ConversationsService,
): Router {
  const router = Router();
  const controller = createConversationsController(service);

  router.post(
    '/conversations/direct',
    authenticate(verifyToken),
    controller.startDirect,
  );
  return router;
}
