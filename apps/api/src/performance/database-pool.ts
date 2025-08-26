/**
 * Optimized Database Connection Pooling for FlakeGuard
 */
import { PrismaClient, Prisma } from '@prisma/client';

interface DatabasePoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeoutMs: number;
  queryTimeoutMs: number;
}

const DEFAULT_POOL_CONFIG: DatabasePoolConfig = {
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '30'),
  minConnections: parseInt(process.env.DB_MIN_CONNECTIONS ?? '5'),
  acquireTimeoutMs: 30000,
  queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '30000'),
};

export class DatabasePool {
  private static instance: DatabasePool;
  private prismaClient: PrismaClient;
  private config: DatabasePoolConfig;

  private constructor(config: Partial<DatabasePoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.prismaClient = this.createOptimizedClient();
  }

  public static getInstance(config?: Partial<DatabasePoolConfig>): DatabasePool {
    if (!DatabasePool.instance) {
      DatabasePool.instance = new DatabasePool(config);
    }
    return DatabasePool.instance;
  }

  public getClient(): PrismaClient {
    return this.prismaClient;
  }

  private createOptimizedClient(): PrismaClient {
    const databaseUrlString = process.env.DATABASE_URL;
    if (!databaseUrlString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    
    const databaseUrl = new URL(databaseUrlString);
    
    databaseUrl.searchParams.set('connection_limit', this.config.maxConnections.toString());
    databaseUrl.searchParams.set('pool_timeout', Math.floor(this.config.acquireTimeoutMs / 1000).toString());
    
    return new PrismaClient({
      datasources: {
        db: { url: databaseUrl.toString() },
      },
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  public async executeTransaction<T>(
    fn: (prisma: Prisma.TransactionClient) => Promise<T>,
    options: { maxWait?: number; timeout?: number } = {}
  ): Promise<T> {
    const { maxWait = 5000, timeout = this.config.queryTimeoutMs } = options;
    return this.prismaClient.$transaction(fn, { maxWait, timeout });
  }
}

export function createOptimizedPrismaClient(config?: Partial<DatabasePoolConfig>): PrismaClient {
  return DatabasePool.getInstance(config).getClient();
}
