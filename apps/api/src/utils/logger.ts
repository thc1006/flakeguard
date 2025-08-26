import pino from 'pino';

import { config } from '../config/index.js';

const pinoInstance = (pino as any).default || pino;
export const logger = pinoInstance({
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