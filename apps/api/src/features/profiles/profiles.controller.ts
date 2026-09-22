import type { Request, Response } from 'express';
import { interestIdSchema, profileUpdateSchema } from '@swapcircle/contracts';
import { errorBody } from '../../http/error-response.js';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import {
  RestrictedAccountError,
  UnknownInterestError,
} from './profiles.repository.js';
import type { ProfilesService } from './profiles.service.js';

export function createProfilesController(service: ProfilesService) {
  return {
    current: async (
      _request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const profile = await service.current(response.locals.identity.userId);

      response.json(profile);
    },
    update: async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => {
      const parsed = profileUpdateSchema.safeParse(request.body);

      if (!parsed.success) {
        response
          .status(400)
          .json(
            errorBody(
              'INVALID_PROFILE',
              'Check the profile fields and interest IDs.',
              response.getHeader('X-Request-Id'),
            ),
          );

        return;
      }

      try {
        response.json(
          await service.update(response.locals.identity.userId, parsed.data),
        );
      } catch (error) {
        if (error instanceof UnknownInterestError) {
          response
            .status(400)
            .json(
              errorBody(
                'UNKNOWN_INTEREST',
                'Choose interests from the catalogue.',
                response.getHeader('X-Request-Id'),
              ),
            );

          return;
        }

        if (error instanceof RestrictedAccountError) {
          response
            .status(403)
            .json(
              errorBody(
                'ACCOUNT_RESTRICTED',
                'This account cannot update its profile.',
                response.getHeader('X-Request-Id'),
              ),
            );

          return;
        }

        throw error;
      }
    },
    interests: async (_request: Request, response: Response) => {
      response.json(await service.interests());
    },
    publicProfile: async (request: Request, response: Response) => {
      const parsed = interestIdSchema.safeParse(request.params.id);

      if (!parsed.success) {
        response
          .status(404)
          .json(
            errorBody(
              'NOT_FOUND',
              'Member not found.',
              response.getHeader('X-Request-Id'),
            ),
          );

        return;
      }

      const profile = await service.publicProfile(parsed.data);

      if (!profile) {
        response
          .status(404)
          .json(
            errorBody(
              'NOT_FOUND',
              'Member not found.',
              response.getHeader('X-Request-Id'),
            ),
          );

        return;
      }

      response.json(profile);
    },
  };
}
