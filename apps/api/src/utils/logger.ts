import pino from 'pino';

import { config } from '../config/index.js';

// Handle different pino import structures across versions
const pinoLogger = pino;

export const logger = (pinoLogger as any)({
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