import { createNotificationsRouter } from './features/notifications/notifications.routes.js';
import { createTradesRouter } from './features/trades/trades.routes.js';
import type { TradesService } from './features/trades/trades.service.js';
import type { NotificationsService } from './features/notifications/notifications.service.js';
import type { ConversationsService } from './features/conversations/conversations.service.js';
import { createConversationsRouter } from './features/conversations/conversations.routes.js';
import type { SafetyService } from './features/safety/safety.service.js';
import { createSafetyRouter } from './features/safety/safety.routes.js';
import { createListingsRouter } from './features/listings/listings.routes.js';
import type { ListingsService } from './features/listings/listings.service.js';
import { Router } from 'express';
import type { VerifyToken } from './auth/verify.js';
import { createHealthRouter } from './features/health/health.routes.js';
import { createIdentityRouter } from './features/identity/identity.routes.js';
import { createProfilesRouter } from './features/profiles/profiles.routes.js';
import type { ProfilesService } from './features/profiles/profiles.service.js';
import { createPhotosRouter } from './features/photos/photos.routes.js';
import type { PhotosService } from './features/photos/photos.service.js';

export function createApiRouter(
  verifyToken: VerifyToken,
  profiles?: ProfilesService,
  listings?: ListingsService,
  photos?: PhotosService,
  safety?: SafetyService,
  conversations?: ConversationsService,
  notifications?: NotificationsService,
  trades?: TradesService,
): Router {
  const api = Router();

  api.use(createHealthRouter());
  api.use(createIdentityRouter(verifyToken));

  if (profiles) api.use(createProfilesRouter(verifyToken, profiles));

  if (listings) api.use(createListingsRouter(verifyToken, listings));
  if (photos) api.use(createPhotosRouter(verifyToken, photos));

  if (safety) api.use(createSafetyRouter(verifyToken, safety));

  if (conversations)
    api.use(createConversationsRouter(verifyToken, conversations));

  if (notifications)
    api.use(createNotificationsRouter(verifyToken, notifications));

  if (trades) api.use(createTradesRouter(verifyToken, trades));

  return api;
}
