import type { Request, Response } from 'express';
import type { Liveness } from '@swapcircle/contracts';

export function getLiveness(_request: Request, response: Response<Liveness>) {
  response.setHeader('Cache-Control', 'no-store');
  response.json({ status: 'ok' });
}
