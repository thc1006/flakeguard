/**
 * FlakeGuard Performance Configuration
 */

export interface PerformanceConfig {
  database: {
    maxConnections: number;
    queryTimeoutMs: number;
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
    maxQueryComplexity: number;
    enableQueryLogging: boolean;
    enableSlowQueryLogging: boolean;
    slowQueryThresholdMs: number;
  };
  
  cache: {
    redis: {
      maxRetriesPerRequest: number;
      retryDelayOnFailover: number;
      enableOfflineQueue: boolean;
      lazyConnect: boolean;
      keepAlive: number;
    };
    flakeScores: {
      ttlSeconds: number;
      maxKeys: number;
    };
    testHistory: {
      ttlSeconds: number;
      maxKeys: number;
    };
  };
  
  parser: {
    maxFileSizeMB: number;
    chunkSizeKB: number;
    maxElementDepth: number;
    maxConcurrentFiles: number;
    enableMemoryOptimization: boolean;
    memoryLimitMB: number;
  };
  
  worker: {
    queues: {
      email: { concurrency: number; stalledInterval: number; };
      task: { concurrency: number; stalledInterval: number; };
      report: { concurrency: number; stalledInterval: number; };
      ingestion: { concurrency: number; stalledInterval: number; };
    };
    monitoring: {
      metricsIntervalMs: number;
      memoryCheckIntervalMs: number;
      memoryWarningThresholdMB: number;
      memoryGcThresholdMB: number;
    };
  };
  
  scoring: {
    batchSize: number;
    maxConcurrency: number;
    cacheEnabled: boolean;
    incrementalUpdates: boolean;
  };
  
  api: {
    requestTimeoutMs: number;
    maxRequestSizeMB: number;
    compressionLevel: number;
    enableEtag: boolean;
    enableCors: boolean;
    rateLimiting: {
      windowMs: number;
      maxRequests: number;
      skipSuccessfulRequests: boolean;
    };
  };
}

const DEVELOPMENT_CONFIG: PerformanceConfig = {
  database: {
    maxConnections: 10,
    queryTimeoutMs: 15000,
    connectionTimeoutMs: 10000,
    idleTimeoutMs: 180000,
    maxQueryComplexity: 1000,
    enableQueryLogging: true,
    enableSlowQueryLogging: true,
    slowQueryThresholdMs: 500,
  },
  cache: {
    redis: {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      lazyConnect: true,
      keepAlive: 30000,
    },
    flakeScores: {
      ttlSeconds: 300, // 5 minutes
      maxKeys: 10000,
    },
    testHistory: {
      ttlSeconds: 600, // 10 minutes  
      maxKeys: 5000,
    },
  },
  parser: {
    maxFileSizeMB: 50,
    chunkSizeKB: 64,
    maxElementDepth: 50,
    maxConcurrentFiles: 3,
    enableMemoryOptimization: true,
    memoryLimitMB: 512,
  },
  worker: {
    queues: {
      email: { concurrency: 5, stalledInterval: 30000 },
      task: { concurrency: 3, stalledInterval: 30000 },
      report: { concurrency: 2, stalledInterval: 60000 },
      ingestion: { concurrency: 2, stalledInterval: 120000 },
    },
    monitoring: {
      metricsIntervalMs: 60000,
      memoryCheckIntervalMs: 30000,
      memoryWarningThresholdMB: 512,
      memoryGcThresholdMB: 1024,
    },
  },
  scoring: {
    batchSize: 50,
    maxConcurrency: 5,
    cacheEnabled: true,
    incrementalUpdates: true,
  },
  api: {
    requestTimeoutMs: 30000,
    maxRequestSizeMB: 10,
    compressionLevel: 6,
    enableEtag: true,
    enableCors: true,
    rateLimiting: {
      windowMs: 60000,
      maxRequests: 100,
      skipSuccessfulRequests: false,
    },
  },
};

const PRODUCTION_CONFIG: PerformanceConfig = {
  database: {
    maxConnections: 30,
    queryTimeoutMs: 30000,
    connectionTimeoutMs: 15000,
    idleTimeoutMs: 300000,
    maxQueryComplexity: 2000,
    enableQueryLogging: false,
    enableSlowQueryLogging: true,
    slowQueryThresholdMs: 1000,
  },
  cache: {
    redis: {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      lazyConnect: true,
      keepAlive: 60000,
    },
    flakeScores: {
      ttlSeconds: 600, // 10 minutes
      maxKeys: 50000,
    },
    testHistory: {
      ttlSeconds: 1800, // 30 minutes
      maxKeys: 25000,
    },
  },
  parser: {
    maxFileSizeMB: 100,
    chunkSizeKB: 128,
    maxElementDepth: 100,
    maxConcurrentFiles: 5,
    enableMemoryOptimization: true,
    memoryLimitMB: 2048,
  },
  worker: {
    queues: {
      email: { concurrency: 10, stalledInterval: 30000 },
      task: { concurrency: 8, stalledInterval: 30000 },
      report: { concurrency: 4, stalledInterval: 60000 },
      ingestion: { concurrency: 3, stalledInterval: 180000 },
    },
    monitoring: {
      metricsIntervalMs: 300000, // 5 minutes
      memoryCheckIntervalMs: 60000, // 1 minute
      memoryWarningThresholdMB: 1024,
      memoryGcThresholdMB: 2048,
    },
  },
  scoring: {
    batchSize: 100,
    maxConcurrency: 10,
    cacheEnabled: true,
    incrementalUpdates: true,
  },
  api: {
    requestTimeoutMs: 60000,
    maxRequestSizeMB: 50,
    compressionLevel: 9,
    enableEtag: true,
    enableCors: true,
    rateLimiting: {
      windowMs: 60000,
      maxRequests: 1000,
      skipSuccessfulRequests: true,
    },
  },
};

export function getPerformanceConfig(): PerformanceConfig {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_CONFIG : DEVELOPMENT_CONFIG;
}

export { DEVELOPMENT_CONFIG, PRODUCTION_CONFIG };
