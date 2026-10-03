import {
  initializeMonitoring,
  reportError,
  installFatalErrorHandlers,
} from './observability/sentry.js';
import { createLogger } from './observability/logger.js';
import { HealthService } from './features/health/health.service.js';
import { MeetingsRepository } from './features/meetings/meetings.repository.js';
import { MeetingsService } from './features/meetings/meetings.service.js';
import { CoffeeService } from './features/coffee/coffee.service.js';
import { CoffeeRepository } from './features/coffee/coffee.repository.js';
import { NotificationsService } from './features/notifications/notifications.service.js';
import { TradesService } from './features/trades/trades.service.js';
import { TradesRepository } from './features/trades/trades.repository.js';
import { NotificationsRepository } from './features/notifications/notifications.repository.js';
import { ConversationsService } from './features/conversations/conversations.service.js';
import { ConversationsRepository } from './features/conversations/conversations.repository.js';
import { SafetyPermissions } from './features/safety/safety.permissions.js';
import { SafetyRepository } from './features/safety/safety.repository.js';
import { SafetyService } from './features/safety/safety.service.js';
import { ListingsRepository } from './features/listings/listings.repository.js';
import { ListingsService } from './features/listings/listings.service.js';
import { createTokenVerifier } from './auth/verify.js';
import { createApp } from './app.js';
import { readEnvironment } from './env.js';
import { Pool } from 'pg';
import { databaseConfig } from '@swapcircle/database';
import { ProfilesRepository } from './features/profiles/profiles.repository.js';
import { ProfilesService } from './features/profiles/profiles.service.js';
import { PhotosRepository } from './features/photos/photos.repository.js';
import { PhotosService } from './features/photos/photos.service.js';
import { createPhotoStorage } from './features/photos/photos.storage.js';

installFatalErrorHandlers();

const config = readEnvironment(process.env);
initializeMonitoring(config.sentryDsn, config.revision);

const logger = createLogger();
const pool = new Pool(databaseConfig(config.databaseUrl));

pool.on('error', (error) => {
  const eventId = reportError(error);

  logger.error(
    { eventId, errorCode: 'DATABASE_UNAVAILABLE' },
    'database connection failed',
  );
});

const permissions = new SafetyPermissions(config.limits);

createApp({
  logger,
  health: new HealthService(pool, config.revision),
  meetings: new MeetingsService(new MeetingsRepository(pool), permissions),
  coffee: new CoffeeService(new CoffeeRepository(pool), permissions),
  trades: new TradesService(new TradesRepository(pool), permissions),
  notifications: new NotificationsService(
    new NotificationsRepository(pool),
    permissions,
  ),
  conversations: new ConversationsService(
    new ConversationsRepository(pool),
    permissions,
  ),
  safety: new SafetyService(new SafetyRepository(pool), permissions),
  ...config,
  verifyToken: createTokenVerifier(
    config.supabaseUrl,
    config.supabasePublishableKey,
  ),
  listings: new ListingsService(new ListingsRepository(pool, permissions)),
  photos: new PhotosService(
    new PhotosRepository(pool, permissions),
    createPhotoStorage(config.supabaseUrl, config.supabaseServiceRoleKey),
  ),
  profiles: new ProfilesService(
    new ProfilesRepository(pool, permissions),
    createPhotoStorage(config.supabaseUrl, config.supabaseServiceRoleKey),
  ),
}).listen(config.port, () => {
  logger.info({ revision: config.revision }, 'API listening');
});
