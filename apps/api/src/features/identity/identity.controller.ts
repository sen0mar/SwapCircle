import type { Request, Response } from 'express';
import type { Identity } from '@swapcircle/contracts';
import type { AuthenticatedLocals } from '../../middleware/authenticate.js';

export function getIdentity(
  _request: Request,
  response: Response<Identity, AuthenticatedLocals>,
) {
  response.json(response.locals.identity);
}
