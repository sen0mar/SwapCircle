import type { Request, Response } from 'express';
import { directConversationStartSchema } from '@swapcircle/contracts';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import type { ConversationsService } from './conversations.service.js';

export function createConversationsController(service: ConversationsService) {
  return {
    startDirect: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = directConversationStartSchema.parse(request.body);

      response
        .status(200)
        .json(
          await service.startDirect(
            response.locals.identity.userId,
            input.userId,
          ),
        );
    },
  };
}
