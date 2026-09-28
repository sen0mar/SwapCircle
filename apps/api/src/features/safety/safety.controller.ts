import type { Request, Response } from 'express';
import {
  blockQuerySchema,
  blockTargetSchema,
  reportSubmissionSchema,
} from '@swapcircle/contracts';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import type { SafetyService } from './safety.service.js';

export function createSafetyController(service: SafetyService) {
  return {
    ownBlocks: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      response.json(
        await service.ownBlocks(
          response.locals.identity.userId,
          blockQuerySchema.parse(request.query),
        ),
      );
    },
    block: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = blockTargetSchema.parse(request.body);
      await service.setBlock(
        response.locals.identity.userId,
        input.userId,
        true,
      );
      response.status(204).end();
    },
    unblock: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = blockTargetSchema.parse(request.params);
      await service.setBlock(
        response.locals.identity.userId,
        input.userId,
        false,
      );
      response.status(204).end();
    },
    report: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const input = reportSubmissionSchema.parse(request.body);
      response
        .status(201)
        .json(
          await service.submitReport(response.locals.identity.userId, input),
        );
    },
  };
}
