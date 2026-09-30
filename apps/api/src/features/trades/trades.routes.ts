import { Router } from 'express';
import {
  tradeIdParamsSchema,
  tradePageQuerySchema,
} from '@swapcircle/contracts';
import type { VerifyToken } from '../../auth/verify.js';
import {
  authenticate,
  type AuthenticatedLocals,
} from '../../middleware/authenticate.js';
import type { TradesService } from './trades.service.js';

export function createTradesRouter(
  verifyToken: VerifyToken,
  service: TradesService,
): Router {
  const router = Router();

  router.get(
    '/trades/mine',
    authenticate(verifyToken),
    async (
      request,
      response: import('express').Response<unknown, AuthenticatedLocals>,
    ) => {
      const query = tradePageQuerySchema.parse(request.query);
      response.json(
        await service.page(
          response.locals.identity.userId,
          query.limit,
          query.after,
        ),
      );
    },
  );

  router.get(
    '/trades/:id',
    authenticate(verifyToken),
    async (
      request,
      response: import('express').Response<unknown, AuthenticatedLocals>,
    ) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      response.json(await service.detail(response.locals.identity.userId, id));
    },
  );

  return router;
}
