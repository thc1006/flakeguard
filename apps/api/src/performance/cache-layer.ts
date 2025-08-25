/**
 * Redis Caching Layer for FlakeGuard Performance Optimization
 */
import Redis from 'ioredis';

import { logger } from '../utils/logger.js';

interface CacheConfig {
  ttl: number; // Time to live in seconds
  keyPrefix: string;
  compression: boolean;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  avgLatency: number;
}

export class CacheLayer {
  private redis: Redis;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    avgLatency: 0,
  };

  constructor(private config: CacheConfig) {
    this.redis = new Redis(process.env.REDIS_URL!, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
    });

    this.redis.on('error', (err) => {
      this.stats.errors++;
      logger.error('Redis cache error', { error: err.message });
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();
    const fullKey = `${this.config.keyPrefix}:${key}`;
    
    try {
      const value = await this.redis.get(fullKey);
      this.updateLatency(Date.now() - startTime);
      
      if (value === null) {
        this.stats.misses++;
        return null;
      }
      
      this.stats.hits++;
      return JSON.parse(value);
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache get error', { key: fullKey, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const startTime = Date.now();
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const cacheTtl = ttl || this.config.ttl;
    
    try {
      await this.redis.setex(fullKey, cacheTtl, JSON.stringify(value));
      this.updateLatency(Date.now() - startTime);
      this.stats.sets++;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache set error', { key: fullKey, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const startTime = Date.now();
    const fullKeys = keys.map(key => `${this.config.keyPrefix}:${key}`);
    
    try {
      const values = await this.redis.mget(...fullKeys);
      this.updateLatency(Date.now() - startTime);
      
      return values.map(value => {
        if (value === null) {
          this.stats.misses++;
          return null;
        }
        this.stats.hits++;
        return JSON.parse(value);
      });
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache mget error', { keys: fullKeys, error: error instanceof Error ? error.message : String(error) });
      return keys.map(() => null);
    }
  }

  async del(key: string): Promise<void> {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    try {
      await this.redis.del(fullKey);
      this.stats.deletes++;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache delete error', { key: fullKey, error: error instanceof Error ? error.message : String(error) });
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }

  private updateLatency(latency: number): void {
    const totalOps = this.stats.hits + this.stats.misses + this.stats.sets;
    this.stats.avgLatency = (this.stats.avgLatency * (totalOps - 1) + latency) / totalOps;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// Specific cache instances for different use cases
export class FlakeScoreCache extends CacheLayer {
  constructor() {
    super({
      ttl: 300, // 5 minutes
      keyPrefix: 'flake_score',
      compression: false,
    });
  }

  async getFlakeScore(repositoryId: string, testFullName: string) {
    return this.get(`${repositoryId}:${testFullName}`);
  }

  async setFlakeScore(repositoryId: string, testFullName: string, score: any) {
    return this.set(`${repositoryId}:${testFullName}`, score);
  }
}

export class TestHistoryCache extends CacheLayer {
  constructor() {
    super({
      ttl: 600, // 10 minutes
      keyPrefix: 'test_history',
      compression: true,
    });
  }

  async getTestHistory(repositoryId: string, testFullName: string, limit: number = 50) {
    return this.get(`${repositoryId}:${testFullName}:${limit}`);
  }

  async setTestHistory(repositoryId: string, testFullName: string, limit: number, history: any[]) {
    return this.set(`${repositoryId}:${testFullName}:${limit}`, history);
  }
}

export class TestStatsCache extends CacheLayer {
  constructor() {
    super({
      ttl: 900, // 15 minutes
      keyPrefix: 'test_stats',
      compression: false,
    });
  }

  async getRepositoryStats(repositoryId: string, timeRange?: string) {
    const key = timeRange ? `${repositoryId}:${timeRange}` : repositoryId;
    return this.get(key);
  }

  async setRepositoryStats(repositoryId: string, stats: any, timeRange?: string) {
    const key = timeRange ? `${repositoryId}:${timeRange}` : repositoryId;
    return this.set(key, stats);
  }
}
