import { reportError } from '../observability/sentry.js';
import { SafetyError } from '../features/safety/safety.permissions.js';
import { z } from 'zod';
import type { ErrorRequestHandler } from 'express';
import { errorBody } from '../http/error-response.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  // Keep the four-argument Express error-middleware signature.
  void next;

  // Capture failures even when the connection can no longer receive an envelope.
  if (!(error instanceof SafetyError) && !(error instanceof z.ZodError)) {
    response.locals.monitoringErrorCode = 'INTERNAL_ERROR';
  }

  if (response.headersSent) {
    response.locals.monitoringEventId = reportError(
      error,
      String(response.getHeader('X-Request-Id')),
    );
    response.destroy();

    return;
  }

  if (error instanceof SafetyError || error instanceof z.ZodError) {
    response.locals.monitoringErrorCode =
      error instanceof SafetyError ? error.code : 'INVALID_INPUT';

    if (error instanceof SafetyError && error.retryAfterSeconds !== undefined)
      response.setHeader('Retry-After', error.retryAfterSeconds);
    response
      .status(error instanceof SafetyError ? error.status : 400)
      .json(
        errorBody(
          error instanceof SafetyError ? error.code : 'INVALID_INPUT',
          error instanceof SafetyError
            ? error.message
            : 'Check the request fields.',
          response.getHeader('X-Request-Id'),
        ),
      );
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

  response.locals.monitoringErrorCode = code;

  if (status === 500) {
    response.locals.monitoringEventId = reportError(
      error,
      String(response.getHeader('X-Request-Id')),
    );
  }

  response
    .status(status)
    .json(errorBody(code, message, response.getHeader('X-Request-Id')));
};
