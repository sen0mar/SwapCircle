import type { RequestHandler } from 'express';
import { errorBody } from '../http/error-response.js';

export const notFound: RequestHandler = (_request, response) => {
  response
    .status(404)
    .json(
      errorBody(
        'NOT_FOUND',
        'The requested endpoint was not found.',
        response.getHeader('X-Request-Id'),
      ),
    );
};
