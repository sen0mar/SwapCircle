import type { Request, Response } from 'express';
import {
  notificationMarkReadSchema,
  notificationsMarkAllReadSchema,
} from '@swapcircle/contracts';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import type { NotificationsService } from './notifications.service.js';

export function createNotificationsController(service: NotificationsService) {
  return {
    markRead: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = notificationMarkReadSchema.parse(request.body);

      response.json(
        await service.markRead(response.locals.identity.userId, [
          input.notification_id,
        ]),
      );
    },
    markAllRead: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = notificationsMarkAllReadSchema.parse(request.body);

      response.json(
        await service.markRead(
          response.locals.identity.userId,
          input.notification_ids,
        ),
      );
    },
  };
}
