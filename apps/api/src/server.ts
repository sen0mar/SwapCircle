import { createApp } from './app.js';
import { readEnvironment } from './env.js';

const config = readEnvironment(process.env);
createApp(config).listen(config.port, () => {
  console.info(`SwapCircle API listening on port ${config.port}`);
});
