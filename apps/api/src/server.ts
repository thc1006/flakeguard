import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

async function start() {
  try {
    const app = await buildApp();
    
    await app.listen({
      port: config.port,
      host: config.host,
    });

    logger.info(`Server listening on http://${config.host}:${config.port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

start();