import { Router, type Response } from 'express';
import {
  tradeIdParamsSchema,
  meetingCreateSchema,
  meetingUpdateSchema,
  meetingResponseSchema,
} from '@swapcircle/contracts';
import type { VerifyToken } from '../../auth/verify.js';
import {
  authenticate,
  type AuthenticatedLocals,
} from '../../middleware/authenticate.js';
import type { MeetingsService } from './meetings.service.js';

export function createMeetingsRouter(
  verify: VerifyToken,
  service: MeetingsService,
): Router {
  const router = Router();

  for (const [path, byTrade] of [
    ['/meetups/:id', false],
    ['/trades/:id/meeting', true],
  ] as const) {
    router.get(
      path,
      authenticate(verify),
      async (request, response: Response<unknown, AuthenticatedLocals>) => {
        const { id } = tradeIdParamsSchema.parse(request.params);
        response.json(
          await service.read(response.locals.identity.userId, id, byTrade),
        );
      },
    );
  }

  router.post(
    '/trades/:id/meeting',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      response
        .status(201)
        .json(
          await service.write(
            response.locals.identity.userId,
            id,
            meetingCreateSchema.parse(request.body),
            'create',
          ),
        );
    },
  );

  router.put(
    '/trades/:id/meeting',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      response.json(
        await service.write(
          response.locals.identity.userId,
          id,
          meetingUpdateSchema.parse(request.body),
          'update',
        ),
      );
    },
  );

  router.post(
    '/trades/:id/meeting/respond',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      response.json(
        await service.write(
          response.locals.identity.userId,
          id,
          meetingResponseSchema.parse(request.body),
          'respond',
        ),
      );
    },
  );

  return router;
}
