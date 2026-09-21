import type { ErrorRequestHandler } from 'express';
import { errorBody } from '../http/error-response.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);

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
