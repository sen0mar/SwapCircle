import { createTokenVerifier } from './auth/verify.js';
import { createApp } from './app.js';
import { readEnvironment } from './env.js';

const config = readEnvironment(process.env);

createApp({
  ...config,
  verifyToken: createTokenVerifier(
    config.supabaseUrl,
    config.supabasePublishableKey,
  ),
}).listen(config.port, () => {
  console.info(`SwapCircle API listening on port ${config.port}`);
});
