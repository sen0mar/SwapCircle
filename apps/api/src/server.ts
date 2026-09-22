import { createTokenVerifier } from './auth/verify.js';
import { createApp } from './app.js';
import { readEnvironment } from './env.js';
import { Pool } from 'pg';
import { databaseConfig } from '@swapcircle/database';
import { ProfilesRepository } from './features/profiles/profiles.repository.js';
import { ProfilesService } from './features/profiles/profiles.service.js';

const config = readEnvironment(process.env);
const pool = new Pool(databaseConfig(config.databaseUrl));

createApp({
  ...config,
  verifyToken: createTokenVerifier(
    config.supabaseUrl,
    config.supabasePublishableKey,
  ),
  profiles: new ProfilesService(new ProfilesRepository(pool)),
}).listen(config.port, () => {
  console.info(`SwapCircle API listening on port ${config.port}`);
});
