/**
 * Logger utility for FlakeGuard
 * 
 * Provides structured logging throughout the application with appropriate
 * log levels and formatting for both development and production use.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
}

class FlakeGuardLogger implements Logger {
  private readonly namespace: string;
  private readonly logLevel: LogLevel;

  constructor(namespace: string, logLevel: LogLevel = 'info') {
    this.namespace = namespace;
    this.logLevel = logLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext, error?: Error): string {
    const timestamp = new Date().toISOString();
    const baseLog: {
      timestamp: string;
      level: string;
      namespace: string;
      message: string;
      error?: {
        name: string;
        message: string;
        stack?: string;
      };
      [key: string]: unknown;
    } = {
      timestamp,
      level: level.toUpperCase(),
      namespace: this.namespace,
      message,
      ...context,
    };

    if (error) {
      baseLog.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return JSON.stringify(baseLog);
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) {return;}
    process.stdout.write(this.formatMessage('debug', message, context) + '\n');
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) {return;}
    process.stdout.write(this.formatMessage('info', message, context) + '\n');
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) {return;}
    process.stderr.write(this.formatMessage('warn', message, context) + '\n');
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog('error')) {return;}
    process.stderr.write(this.formatMessage('error', message, context, error) + '\n');
  }
}

/**
 * Creates a logger instance for the given namespace
 */
export function createLogger(namespace: string): Logger {
  const logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  return new FlakeGuardLogger(namespace, logLevel);
}

/**
 * Default logger for general use
 */
export const logger = createLogger('flakeguard');