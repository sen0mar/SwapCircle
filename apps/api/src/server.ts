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

const config = readEnvironment(process.env);
const pool = new Pool(databaseConfig(config.databaseUrl));

const permissions = new SafetyPermissions(config.limits);

createApp({
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
  console.info(`SwapCircle API listening on port ${config.port}`);
});
