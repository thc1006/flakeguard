/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import pino from 'pino';
import type { Logger } from 'pino';

import { config } from '../config/index.js';

export const logger: Logger = pino({
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