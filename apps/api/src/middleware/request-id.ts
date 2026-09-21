import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requestId: RequestHandler = (_request, response, next) => {
  // Always generate our own ID; never reflect untrusted header values.
  response.setHeader('X-Request-Id', randomUUID());
  next();
};
