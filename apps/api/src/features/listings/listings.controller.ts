import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listingCreateSchema,
  listingUpdateSchema,
  listingRevisionSchema,
  listingQuerySchema,
  listingCursorSchema,
} from '@swapcircle/contracts';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';
import { errorBody } from '../../http/error-response.js';
import { ListingError, type ListingsService } from './listings.service.js';

export function createListingsController(service: ListingsService) {
  function handle(
    work: (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
    ) => Promise<void>,
  ) {
    return async (
      request: Request,
      response: Response<unknown, AuthenticatedLocals>,
      next: NextFunction,
    ) => {
      try {
        await work(request, response);
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof ListingError) {
          const domain =
            error instanceof ListingError
              ? error
              : new ListingError(
                  400,
                  'INVALID_LISTING',
                  'Check the listing fields or pagination.',
                );

          response
            .status(domain.status)
            .json(
              errorBody(
                domain.code,
                domain.message,
                response.getHeader('X-Request-Id'),
              ),
            );

          return;
        }

        next(error);
      }
    };
  }

  return {
    mine: handle(async (request, response) => {
      const query = listingQuerySchema.parse(request.query);
      response.json(
        await service.ownerPage(
          response.locals.identity.userId,
          query.limit,
          parseCursor(query.cursor),
        ),
      );
    }),
    create: handle(async (request, response) => {
      const input = listingCreateSchema.parse(request.body);

      response
        .status(201)
        .json(await service.create(response.locals.identity.userId, input));
    }),
    edit: handle(async (request, response) => {
      const id = z.uuid().parse(request.params.id);
      const input = listingUpdateSchema.parse(request.body);

      response.json(
        await service.change(
          response.locals.identity.userId,
          id,
          input.revision,
          input,
        ),
      );
    }),
    withdraw: handle(async (request, response) => {
      const id = z.uuid().parse(request.params.id);
      const input = listingRevisionSchema.parse(request.body);

      response.json(
        await service.change(
          response.locals.identity.userId,
          id,
          input.revision,
        ),
      );
    }),
    detail: handle(async (request, response) => {
      response.json(
        await service.publicListing(z.uuid().parse(request.params.id)),
      );
    }),
    page: handle(async (request, response) => {
      const query = listingQuerySchema.parse(request.query);
      response.json(await service.page(query.limit, parseCursor(query.cursor)));
    }),
  };
}

function parseCursor(value: string | undefined) {
  if (value === undefined) return undefined;

  try {
    return listingCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw new ListingError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
  }
}
