import type { Request, Response } from 'express';
import type { HealthService } from './health.service.js';
import type { Liveness, Readiness } from '@swapcircle/contracts';

export function getLiveness(_request: Request, response: Response<Liveness>) {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ status: 'ok' });
}

export function readinessController(health: HealthService) {
  return async (_request: Request, response: Response<Readiness>) => {
    const result = await health.readiness();

    response.setHeader('Cache-Control', 'no-store');
    if (result.status === 'unavailable')
      response.locals.monitoringErrorCode = 'DATABASE_UNAVAILABLE';

    response.status(result.status === 'ready' ? 200 : 503).json(result);
  };
}
