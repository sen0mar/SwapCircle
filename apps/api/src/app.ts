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

export function createApp({
  allowedOrigins,
  verifyToken = async () => null,
  profiles,
}: {
  allowedOrigins: readonly string[];
  verifyToken?: VerifyToken;
  profiles?: ProfilesService;
}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin !== undefined && allowedOrigins.includes(origin)),
      exposedHeaders: ['X-Request-Id'],
      methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'],
    }),
  );

  app.use(express.json({ limit: '16kb' }));
  app.use('/api/v1', createApiRouter(verifyToken, profiles));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
