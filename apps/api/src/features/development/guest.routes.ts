import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { errorBody } from '../../http/error-response.js';
import { hostedDemoFrontend } from './demo-guard.js';
import {
  GuestService,
  demoCredentialsPath,
  type GuestConfiguration,
} from './guest.service.js';

export function createGuestRouter(
  config: GuestConfiguration & { allowedOrigins: readonly string[] },
  credentialsPath = demoCredentialsPath,
): Router {
  if (
    config.hostedCredentials !== undefined &&
    (config.allowedOrigins.length !== 1 ||
      config.allowedOrigins[0] !== hostedDemoFrontend)
  )
    throw new Error('Hosted guest requires the production frontend origin.');
  const service = new GuestService(config, credentialsPath);
  const router = Router();
  const fail = (response: import('express').Response, status: number) =>
    response
      .status(status)
      .json(
        errorBody(
          'GUEST_UNAVAILABLE',
          'Guest sign-in is unavailable. Try again later.',
          response.getHeader('X-Request-Id'),
        ),
      );

  router.post(
    '/auth/guest',
    (_request, response, next) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
      handler: (_request, response) => {
        fail(response, 429);
      },
    }),
    async (request, response) => {
      if (!config.allowedOrigins.includes(request.get('Origin') ?? '')) {
        fail(response, 403);
        return;
      }
      try {
        response.json(await service.signIn());
      } catch {
        // Never forward provider errors, credentials, or session contents to logs.
        fail(response, 503);
      }
    },
  );

  return router;
}
