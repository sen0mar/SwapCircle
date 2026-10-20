import { Router, json } from 'express';
import {
  tradeMessageSubmissionSchema,
  groupMembershipParamsSchema,
} from '@swapcircle/contracts';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import type { ConversationsService } from './conversations.service.js';

export function createProposalMessageRouter(
  verifyToken: VerifyToken,
  service: ConversationsService,
): Router {
  const router = Router();

  router.post(
    '/conversations/proposals',
    authenticate(verifyToken),
    json({ limit: '7mb' }),
    async (request, response) => {
      const input = tradeMessageSubmissionSchema.parse(request.body);
      response.setHeader('Cache-Control', 'no-store');
      response.json(
        await service.sendProposal(response.locals.identity.userId, input),
      );
    },
  );

  router.get(
    '/conversations/messages/:id/photo',
    authenticate(verifyToken),
    async (request, response) => {
      const { id } = groupMembershipParamsSchema.parse(request.params);
      response.setHeader('Cache-Control', 'no-store');
      response.json(
        await service.readPhoto(response.locals.identity.userId, id),
      );
    },
  );

  return router;
}
