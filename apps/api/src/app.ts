import type { CoffeeService } from './features/coffee/coffee.service.js';
import type { NotificationsService } from './features/notifications/notifications.service.js';
import type { TradesService } from './features/trades/trades.service.js';
import type { ConversationsService } from './features/conversations/conversations.service.js';
import { rateLimit } from 'express-rate-limit';
import { errorBody } from './http/error-response.js';
import {
  developmentLimits,
  type SafetyLimits,
} from './features/safety/safety.permissions.js';
import type { SafetyService } from './features/safety/safety.service.js';
import type { ListingsService } from './features/listings/listings.service.js';
import type { VerifyToken } from './auth/verify.js';
import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createApiRouter } from './routes.js';
import { requestId } from './middleware/request-id.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import type { ProfilesService } from './features/profiles/profiles.service.js';
import type { PhotosService } from './features/photos/photos.service.js';

export function createApp({
  allowedOrigins,
  verifyToken = async () => null,
  profiles,
  listings,
  photos,
  safety,
  conversations,
  notifications,
  trades,
  coffee,
  limits = developmentLimits,
}: {
  allowedOrigins: readonly string[];
  verifyToken?: VerifyToken;
  profiles?: ProfilesService;
  listings?: ListingsService;
  photos?: PhotosService;
  safety?: SafetyService;
  conversations?: ConversationsService;
  notifications?: NotificationsService;
  trades?: TradesService;
  coffee?: CoffeeService;
  limits?: SafetyLimits;
}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin !== undefined && allowedOrigins.includes(origin)),
      exposedHeaders: [
        'X-Request-Id',
        'Retry-After',
        'RateLimit',
        'RateLimit-Policy',
      ],
      methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
    }),
  );

  app.use(
    rateLimit({
      windowMs: limits.burstWindowMs,
      limit: limits.burstMax,
      skip: (request) => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
      standardHeaders: 'draft-8',
      // Forwarded addresses are untrusted; they never choose this limiter's key.
      validate: { xForwardedForHeader: false },
      legacyHeaders: false,
      handler: (_request, response) =>
        response
          .status(429)
          .json(
            errorBody(
              'BURST_LIMIT',
              'Too many requests. Try again shortly.',
              response.getHeader('X-Request-Id'),
            ),
          ),
    }),
  );

  app.use(express.json({ limit: '16kb' }));
  app.use(
    '/api/v1',
    createApiRouter(
      verifyToken,
      profiles,
      listings,
      photos,
      safety,
      conversations,
      notifications,
      trades,
      coffee,
    ),
  );
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
