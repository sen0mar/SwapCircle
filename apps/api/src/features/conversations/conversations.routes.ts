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
  router.post(
    '/conversations/messages',
    authenticate(verifyToken),
    controller.send,
  );

  router.get(
    '/conversations/:id/unread',
    authenticate(verifyToken),
    controller.unread,
  );
  router.put(
    '/conversations/read',
    authenticate(verifyToken),
    controller.markRead,
  );

  router.put(
    '/conversations/:id/invitation/accept',
    authenticate(verifyToken),
    controller.acceptGroup,
  );
  router.put(
    '/conversations/:id/invitation/decline',
    authenticate(verifyToken),
    controller.declineGroup,
  );
  router.put(
    '/conversations/:id/leave',
    authenticate(verifyToken),
    controller.leaveGroup,
  );

  return router;
}
