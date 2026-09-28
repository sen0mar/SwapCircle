import { Router, raw } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { VerifyToken } from '../../auth/verify.js';
import { authenticate } from '../../middleware/authenticate.js';
import { errorBody } from '../../http/error-response.js';
import { PhotoError } from '../photos/photos.service.js';
import {
  RestrictedAccountError,
  AvatarChangedError,
} from './profiles.repository.js';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import { createProfilesController } from './profiles.controller.js';
import type { ProfilesService } from './profiles.service.js';

export function createProfilesRouter(
  verifyToken: VerifyToken,
  service: ProfilesService,
): Router {
  const router = Router();
  const controller = createProfilesController(service);

  router.get('/profiles/me', authenticate(verifyToken), controller.current);
  router.put('/profiles/me', authenticate(verifyToken), controller.update);
  router.post(
    '/profiles/me/avatar',
    authenticate(verifyToken),
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
    async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
      next: NextFunction,
    ) => {
      try {
        if (!Buffer.isBuffer(request.body))
          throw new PhotoError(
            415,
            'INVALID_PHOTO',
            'Choose a valid JPEG, PNG, or WebP image.',
          );
        response
          .status(201)
          .json(
            await service.uploadAvatar(
              response.locals.identity.userId,
              request.body,
            ),
          );
      } catch (error) {
        if (
          error instanceof PhotoError ||
          error instanceof RestrictedAccountError ||
          error instanceof AvatarChangedError
        ) {
          const status =
            error instanceof PhotoError
              ? error.status
              : error instanceof AvatarChangedError
                ? 409
                : 403;
          response
            .status(status)
            .json(
              errorBody(
                error instanceof PhotoError
                  ? error.code
                  : error instanceof AvatarChangedError
                    ? 'AVATAR_CHANGED'
                    : 'ACCOUNT_RESTRICTED',
                error instanceof PhotoError
                  ? error.message
                  : error instanceof AvatarChangedError
                    ? 'Your avatar changed. Reload and try again.'
                    : 'This account cannot change its avatar.',
                response.getHeader('X-Request-Id'),
              ),
            );
        } else next(error);
      }
    },
  );
  router.delete(
    '/profiles/me/avatar',
    authenticate(verifyToken),
    async (
      _request: Request,
      response: Response<unknown, AuthenticatedLocals>,
      next: NextFunction,
    ) => {
      try {
        response.json(
          await service.removeAvatar(response.locals.identity.userId),
        );
      } catch (error) {
        if (
          error instanceof PhotoError ||
          error instanceof RestrictedAccountError ||
          error instanceof AvatarChangedError
        )
          response
            .status(
              error instanceof PhotoError
                ? error.status
                : error instanceof AvatarChangedError
                  ? 409
                  : 403,
            )
            .json(
              errorBody(
                error instanceof PhotoError
                  ? error.code
                  : error instanceof AvatarChangedError
                    ? 'AVATAR_CHANGED'
                    : 'ACCOUNT_RESTRICTED',
                error instanceof PhotoError
                  ? error.message
                  : error instanceof AvatarChangedError
                    ? 'Your avatar changed. Reload and try again.'
                    : 'This account cannot change its avatar.',
                response.getHeader('X-Request-Id'),
              ),
            );
        else next(error);
      }
    },
  );
  router.post(
    '/profiles/me/avatar/cleanup',
    authenticate(verifyToken),
    async (
      _request: Request,
      response: Response<unknown, AuthenticatedLocals>,
      next: NextFunction,
    ) => {
      try {
        response.json(
          await service.retryAvatarCleanup(response.locals.identity.userId),
        );
      } catch (error) {
        if (error instanceof PhotoError)
          response
            .status(error.status)
            .json(
              errorBody(
                error.code,
                error.message,
                response.getHeader('X-Request-Id'),
              ),
            );
        else next(error);
      }
    },
  );
  router.get('/interests', controller.interests);
  router.get('/members', controller.discover);
  router.get(
    '/members/discovery',
    authenticate(verifyToken),
    controller.discover,
  );
  router.get('/members/:id', controller.publicProfile);

  return router;
}
