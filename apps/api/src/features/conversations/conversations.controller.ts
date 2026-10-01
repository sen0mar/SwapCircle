import type { Request, Response } from 'express';
import {
  groupMembershipParamsSchema,
  groupMembershipResponseSchema,
  directConversationStartSchema,
  messageSubmissionSchema,
  conversationReadUpdateSchema,
} from '@swapcircle/contracts';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import type { ConversationsService } from './conversations.service.js';

export function createConversationsController(service: ConversationsService) {
  const respondGroup =
    (status: 'accepted' | 'declined' | 'left') =>
    async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const { id } = groupMembershipParamsSchema.parse(request.params);
      // This action has no client-supplied identity or ownership fields.
      groupMembershipResponseSchema.parse(request.body ?? {});

      response.json(
        await service.respondGroup(response.locals.identity.userId, id, status),
      );
    };

  return {
    groupInvitation: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const { id } = groupMembershipParamsSchema.parse(request.params);
      response.json(
        await service.groupInvitation(response.locals.identity.userId, id),
      );
    },
    acceptGroup: respondGroup('accepted'),
    declineGroup: respondGroup('declined'),
    leaveGroup: respondGroup('left'),
    unread: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const id = conversationReadUpdateSchema.shape.conversation_id.parse(
        request.params.id,
      );
      response.json(await service.unread(response.locals.identity.userId, id));
    },
    markRead: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = conversationReadUpdateSchema.parse(request.body);
      response.json(
        await service.markRead(response.locals.identity.userId, input),
      );
    },
    send: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = messageSubmissionSchema.parse(request.body);

      response
        .status(200)
        .json(await service.send(response.locals.identity.userId, input));
    },
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
