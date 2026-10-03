import { Router } from 'express';
import { HealthService } from './health.service.js';
import { getLiveness, readinessController } from './health.controller.js';

export function createHealthRouter(health = new HealthService()): Router {
  const router = Router();

  router.get('/live', getLiveness);
  router.get('/ready', readinessController(health));

  return router;
}
