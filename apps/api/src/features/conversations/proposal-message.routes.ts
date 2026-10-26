import { Router, json } from 'express';
import {
  tradeMessageSubmissionSchema,
  messageProposalResponseSchema,
  acceptedProposalQuerySchema,
  messageIdParamsSchema,
  proposalMeetingUpdateSchema,
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
      const { id } = messageIdParamsSchema.parse(request.params);
      response.setHeader('Cache-Control', 'no-store');
      response.json(
        await service.readPhoto(response.locals.identity.userId, id),
      );
    },
  );

  router.get(
    '/conversations/messages/:id/proposal',
    authenticate(verifyToken),
    async (request, response) => {
      const { id } = messageIdParamsSchema.parse(request.params);
      response.json(
        await service.proposalState(response.locals.identity.userId, id),
      );
    },
  );
  router.put(
    '/conversations/messages/:id/proposal',
    authenticate(verifyToken),
    json({ limit: '16kb' }),
    async (request, response) => {
      const { id } = messageIdParamsSchema.parse(request.params);
      const { action, meeting } = messageProposalResponseSchema.parse(
        request.body,
      );
      response.json(
        await service.respondToProposal(
          response.locals.identity.userId,
          id,
          action,
          meeting,
        ),
      );
    },
  );
  router.get(
    '/conversations/proposals/accepted',
    authenticate(verifyToken),
    async (request, response) => {
      const input = acceptedProposalQuerySchema.parse(request.query);
      response.json(
        await service.acceptedProposals(response.locals.identity.userId, input),
      );
    },
  );

  router.get(
    '/conversations/messages/:id/proposal/detail',
    authenticate(verifyToken),
    async (request, response) => {
      const { id } = messageIdParamsSchema.parse(request.params);
      response.setHeader('Cache-Control', 'no-store');
      response.json(
        await service.acceptedProposalDetail(
          response.locals.identity.userId,
          id,
        ),
      );
    },
  );
  router.put(
    '/conversations/messages/:id/proposal/meeting',
    authenticate(verifyToken),
    json({ limit: '16kb' }),
    async (request, response) => {
      const { id } = messageIdParamsSchema.parse(request.params);
      const input = proposalMeetingUpdateSchema.parse(request.body);
      response.setHeader('Cache-Control', 'no-store');
      response.json(
        await service.acceptedProposalDetail(
          response.locals.identity.userId,
          id,
          input,
        ),
      );
    },
  );

  return router;
}
