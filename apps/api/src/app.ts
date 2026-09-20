import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import type { ErrorRequestHandler, Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { ApiErrorResponse, Liveness } from '@swapcircle/contracts';

export function createApp({
  allowedOrigins,
}: {
  allowedOrigins: readonly string[];
}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    // Always generate our own ID; never reflect untrusted header values.
    response.setHeader('X-Request-Id', randomUUID());
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin !== undefined && allowedOrigins.includes(origin)),
      exposedHeaders: ['X-Request-Id'],
      methods: ['GET', 'HEAD', 'OPTIONS', 'POST'],
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  const api = Router();
  api.get('/live', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ status: 'ok' } satisfies Liveness);
  });
  app.use('/api/v1', api);
  app.use((_request, response) => {
    response
      .status(404)
      .json(
        errorBody(
          'NOT_FOUND',
          'The requested endpoint was not found.',
          response.getHeader('X-Request-Id'),
        ),
      );
  });
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next,
  ) => {
    if (response.headersSent) {
      _next(error);
      return;
    }
    const type =
      typeof error === 'object' && error !== null && 'type' in error
        ? error.type
        : undefined;
    const [status, code, message] =
      type === 'entity.parse.failed'
        ? ([
            400,
            'INVALID_JSON',
            'The request body must contain valid JSON.',
          ] as const)
        : type === 'entity.too.large'
          ? ([413, 'BODY_TOO_LARGE', 'The request body is too large.'] as const)
          : type === 'encoding.unsupported' || type === 'charset.unsupported'
            ? ([
                415,
                'UNSUPPORTED_ENCODING',
                'The request encoding is not supported.',
              ] as const)
            : ([
                500,
                'INTERNAL_ERROR',
                'The request could not be completed.',
              ] as const);
    response
      .status(status)
      .json(errorBody(code, message, response.getHeader('X-Request-Id')));
  };
  app.use(handleError);
  return app;
}
function errorBody(
  code: string,
  message: string,
  requestId: unknown,
): ApiErrorResponse {
  return { error: { code, message, requestId: String(requestId) } };
}
