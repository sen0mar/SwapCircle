import type { RequestHandler } from 'express';
import type { Identity } from '@swapcircle/contracts';
import type { VerifyToken } from '../auth/verify.js';
import { errorBody } from '../http/error-response.js';

export type AuthenticatedLocals = { identity: Identity };

export function authenticate(
  verifyToken: VerifyToken,
): RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  unknown,
  AuthenticatedLocals
> {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');

    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );

    const userId = match?.[1] ? await verifyToken(match[1]) : null;

    if (!userId) {
      response.setHeader('WWW-Authenticate', 'Bearer');

      response
        .status(401)
        .json(
          errorBody(
            'UNAUTHORIZED',
            'Sign in to continue.',
            response.getHeader('X-Request-Id'),
          ),
        );

      return;
    }

    response.locals.identity = { userId };
    next();
  };
}
