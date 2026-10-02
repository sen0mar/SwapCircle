import { Router, type Response } from 'express';
import {
  coffeeInvitationParamsSchema,
  coffeeSendSchema,
  coffeeResponseSchema,
  coffeeEligibilityQuerySchema,
  tradeIdParamsSchema,
} from '@swapcircle/contracts';
import type { VerifyToken } from '../../auth/verify.js';
import {
  authenticate,
  type AuthenticatedLocals,
} from '../../middleware/authenticate.js';
import type { CoffeeService } from './coffee.service.js';

export function createCoffeeRouter(
  verify: VerifyToken,
  service: CoffeeService,
): Router {
  const router = Router();

  router.get(
    '/trades/:id/coffee/eligibility',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      const { inviteeId } = coffeeEligibilityQuerySchema.parse(request.query);
      response.json(
        await service.eligibility(
          response.locals.identity.userId,
          id,
          inviteeId,
        ),
      );
    },
  );

  router.get(
    '/trades/:id/coffee',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      response.json(await service.list(response.locals.identity.userId, id));
    },
  );

  router.post(
    '/trades/:id/coffee',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id } = tradeIdParamsSchema.parse(request.params);
      response
        .status(201)
        .json(
          await service.send(
            response.locals.identity.userId,
            id,
            coffeeSendSchema.parse(request.body),
          ),
        );
    },
  );

  router.post(
    '/trades/:id/coffee/:invitationId/respond',
    authenticate(verify),
    async (request, response: Response<unknown, AuthenticatedLocals>) => {
      const { id, invitationId } = coffeeInvitationParamsSchema.parse(
        request.params,
      );
      response.json(
        await service.respond(
          response.locals.identity.userId,
          id,
          invitationId,
          coffeeResponseSchema.parse(request.body),
        ),
      );
    },
  );

  return router;
}
