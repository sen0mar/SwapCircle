import { Router, raw } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { VerifyToken } from '../../auth/verify.js';
import {
  authenticate,
  type AuthenticatedLocals,
} from '../../middleware/authenticate.js';
import { errorBody } from '../../http/error-response.js';
import { PhotoError, type PhotosService } from './photos.service.js';

export function createPhotosRouter(
  verifyToken: VerifyToken,
  service: PhotosService,
): Router {
  const router = Router();
  const handle =
    (
      work: (
        request: Request,
        response: Response<unknown, AuthenticatedLocals>,
      ) => Promise<void>,
    ) =>
    async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
      next: NextFunction,
    ) => {
      try {
        await work(request, response);
      } catch (error) {
        if (error instanceof PhotoError || error instanceof z.ZodError) {
          const failure =
            error instanceof PhotoError
              ? error
              : new PhotoError(
                  400,
                  'INVALID_PHOTO_REQUEST',
                  'Check the photo request.',
                );
          response
            .status(failure.status)
            .json(
              errorBody(
                failure.code,
                failure.message,
                response.getHeader('X-Request-Id'),
              ),
            );
          return;
        }
        next(error);
      }
    };

  router.get(
    '/listings/:id/photos',
    handle(async (request, response) => {
      response.json(await service.list(z.uuid().parse(request.params.id)));
    }),
  );
  router.post(
    '/listings/:id/photos',
    authenticate(verifyToken),
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
    handle(async (request, response) => {
      const id = z.uuid().parse(request.params.id);
      if (!Buffer.isBuffer(request.body))
        throw new PhotoError(
          415,
          'INVALID_PHOTO',
          'Choose a valid JPEG, PNG, or WebP image.',
        );
      response
        .status(201)
        .json(
          await service.upload(
            response.locals.identity.userId,
            id,
            request.body,
          ),
        );
    }),
  );
  router.delete(
    '/listings/:id/photos/:photoId',
    authenticate(verifyToken),
    handle(async (request, response) => {
      await service.remove(
        response.locals.identity.userId,
        z.uuid().parse(request.params.id),
        z.uuid().parse(request.params.photoId),
      );
      response.status(204).end();
    }),
  );
  router.put(
    '/listings/:id/photos/order',
    authenticate(verifyToken),
    handle(async (request, response) => {
      const ids = z
        .array(z.uuid())
        .max(3)
        .refine((items) => new Set(items).size === items.length)
        .parse(request.body?.ids);
      response.json(
        await service.reorder(
          response.locals.identity.userId,
          z.uuid().parse(request.params.id),
          ids,
        ),
      );
    }),
  );
  router.post(
    '/listings/:id/photos/cleanup',
    authenticate(verifyToken),
    handle(async (request, response) => {
      await service.cleanup(
        response.locals.identity.userId,
        z.uuid().parse(request.params.id),
      );
      response.status(204).end();
    }),
  );

  return router;
}
