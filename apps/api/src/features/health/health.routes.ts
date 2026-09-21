import { Router } from 'express';
import { getLiveness } from './health.controller.js';

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/live', getLiveness);
  return router;
}
