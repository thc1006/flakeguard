# FlakeGuard Performance Optimization Implementation Guide

## Quick Start

### 1. Enable Database Connection Pooling
Replace the standard Prisma plugin with the optimized version:

```typescript
// In apps/api/src/app.ts
import prismaOptimized from "./plugins/prisma-optimized.js";

// Replace this:
// await app.register(prisma);

// With this:
await app.register(prismaOptimized);
```

### 2. Apply Database Indexes
Run the optimization SQL script:

```bash
psql $DATABASE_URL -f performance/database/optimized-indexes.sql
```

### 3. Enable Redis Caching
Set environment variables:

```bash
REDIS_URL=redis://localhost:6379
ENABLE_CACHING=true
FLAKE_SCORE_CACHE_TTL=300
```

### 4. Update Worker Configuration  
Use the optimized worker configuration:

```typescript
// In apps/worker/src/index.ts
import "./index-optimized.js";
```

### 5. Environment Variables for Production

Add to your `.env` file:

```bash
# Database Optimization
DB_MAX_CONNECTIONS=30
DB_MIN_CONNECTIONS=5
DB_QUERY_TIMEOUT_MS=30000

# Worker Optimization
WORKER_CONCURRENCY=25
ENABLE_MEMORY_MONITORING=true
MEMORY_GC_THRESHOLD_MB=1024

# Parser Optimization
JUNIT_MAX_FILE_SIZE_MB=100
JUNIT_CHUNK_SIZE_KB=64
ENABLE_PARSER_CACHING=true
```

## Performance Testing

### Run Benchmarks
```bash
cd performance/benchmarks
npm install
npm run test:performance
```

### Monitor Performance
```bash
# Check database performance
npm run db:analyze

# Monitor worker performance  
npm run worker:metrics

# Test API performance
npm run api:benchmark
```

## Rollback Plan

If issues occur, rollback steps:

1. Revert to original Prisma plugin
2. Remove performance indexes (if needed)
3. Disable caching by setting `ENABLE_CACHING=false`  
4. Reduce worker concurrency
5. Monitor and gradually re-enable optimizations

---

For detailed technical information, see `PERFORMANCE_REPORT.md`

