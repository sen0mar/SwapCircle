import { Router } from 'express';
import {
  tradeIdParamsSchema,
  tradePageQuerySchema,
  proposalCreationSchema,
  proposalRevisionSchema,
  tradeVersionParamsSchema,
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

  router.post(
    '/trades',
    authenticate(verifyToken),
    async (
      request,
      response: import('express').Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = proposalCreationSchema.parse(request.body);
      const result = await service.create(
        response.locals.identity.userId,
        input,
      );
      response.status(201).json(result);
    },
  );

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

  router.put(
    '/trades/:id',
    authenticate(verifyToken),
    async (
      request,
      response: import('express').Response<unknown, AuthenticatedLocals>,
    ) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      const input = proposalRevisionSchema.parse(request.body);
      response.json(
        await service.revise(response.locals.identity.userId, id, input),
      );
    },
  );

  router.get(
    '/trades/:id/versions/:version',
    authenticate(verifyToken),
    async (
      request,
      response: import('express').Response<unknown, AuthenticatedLocals>,
    ) => {
      const { id, version } = tradeVersionParamsSchema.parse(request.params);
      response.json(
        await service.version(response.locals.identity.userId, id, version),
      );
    },
  );

  return router;
}
