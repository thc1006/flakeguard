import pino from 'pino';

import { config } from '../config/index.js';

// Handle different pino import structures across versions
const pinoLogger = typeof pino === 'function' ? pino : (pino as { default?: typeof pino; pino?: typeof pino }).default || (pino as { default?: typeof pino; pino?: typeof pino }).pino || pino;

export const logger = pinoLogger({
  level: config.logLevel,
  transport:
    config.env === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss Z',
          },
        }
      : undefined,
});