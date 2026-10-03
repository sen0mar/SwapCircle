import { pino, type DestinationStream } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Request, Response, RequestHandler } from 'express';

export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      base: null,
      // Defense in depth: completion objects and serializers already allowlist.
      redact: {
        paths: [
          'req.headers',
          'req.body',
          'req.query',
          'req.url',
          'res.headers',
          'err',
          'error',
          'authorization',
          'cookie',
          'email',
          'message',
          'stack',
        ],
        remove: true,
      },
    },
    destination,
  );
}

export function requestLogging(logger = createLogger()): RequestHandler {
  const metadata = (
    request: Request,
    response: Response,
    object: { responseTime?: number },
  ) => ({
    method: [
      'GET',
      'HEAD',
      'OPTIONS',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
    ].includes(request.method)
      ? request.method
      : 'OTHER',
    route:
      typeof request.route?.path === 'string'
        ? `/api/v1${request.route.path}`
        : 'unmatched',
    statusCode: response.statusCode,
    responseTime: object.responseTime,
    errorCode: response.locals.monitoringErrorCode,
    eventId: response.locals.monitoringEventId,
  });

  return pinoHttp<Request, Response>({
    logger,
    genReqId: (_request, response) =>
      String(response.getHeader('X-Request-Id')),
    quietReqLogger: true,
    quietResLogger: true,
    wrapSerializers: false,
    serializers: {
      req: (request: Request) => ({
        id: request.id,
        method: [
          'GET',
          'HEAD',
          'OPTIONS',
          'POST',
          'PUT',
          'DELETE',
          'PATCH',
        ].includes(request.method)
          ? request.method
          : 'OTHER',
      }),
      res: (response: Response) => ({ statusCode: response.statusCode }),
      err: () => ({ type: 'ApplicationError' }),
    },
    customLogLevel: (_request, response, error) =>
      error || response.statusCode >= 500
        ? 'error'
        : response.statusCode >= 400
          ? 'warn'
          : 'info',
    customSuccessObject: metadata,
    customErrorObject: (request, response, _error, object) =>
      metadata(request, response, object),
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
  });
}
