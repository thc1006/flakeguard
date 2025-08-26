# FlakeGuard Data Model (P8 Implementation)

This directory contains the comprehensive FlakeGuard data model implementation, including the Prisma schema, migrations, seed data, and sample queries demonstrating the full functionality.

## 📋 Overview

The FlakeGuard data model is designed to support comprehensive test flakiness detection, scoring, and quarantine management across multiple repositories and CI providers. It uses PostgreSQL with carefully crafted indexes for optimal performance.

## 🗄️ Core Models

### FGRepository
Central repository tracking with multi-provider support.
```prisma
model FGRepository {
  id             String   @id @default(cuid())
  provider       String   @default("github") // github, gitlab, etc.
  owner          String
  name           String
  installationId String
  // ... relations and timestamps
}
```

### FGWorkflowRun & FGJob
Workflow execution tracking with hierarchical job structure.
```prisma
model FGWorkflowRun {
  id         String    @id @default(cuid())
  repoId     String
  runId      String    // GitHub run ID
  status     String    // queued, in_progress, completed
  conclusion String?   // success, failure, cancelled, etc.
  // ... jobs relation
}
```

### FGTestCase & FGOccurrence
Test definition and execution history with failure pattern tracking.
```prisma
model FGTestCase {
  id        String   @id @default(cuid())
  repoId    String
  suite     String   // Test suite name
  className String?  // Optional class name
  name      String   // Test method/function name
  file      String?  // Source file path
  ownerTeam String?  // Team responsible
  // ... occurrences relation
}
```

### FGFlakeScore
Rolling window flakiness scoring with configurable thresholds.
```prisma
model FGFlakeScore {
  testId        String   @unique
  score         Float    @default(0.0) // 0.0 to 1.0
  windowN       Int      @default(50)  // Runs in window
  lastUpdatedAt DateTime @updatedAt
}
```

### FGQuarantineDecision
Quarantine workflow with state tracking and expiration.
```prisma
enum FGQuarantineState {
  PROPOSED  // Suggested for quarantine
  ACTIVE    // Currently quarantined
  EXPIRED   // Quarantine period ended
  DISMISSED // Quarantine rejected
  RESOLVED  // Test fixed, no longer flaky
}
```

### FGFailureCluster
Intelligent failure grouping for pattern recognition.
```prisma
model FGFailureCluster {
  failureMsgSignature String   // MD5 hash of normalized message
  failureStackDigest  String?  // MD5 hash of normalized stack
  testIds             String[] // Array of affected test IDs
  occurrenceCount     Int      // Total occurrences
  // ... clustering relations
}
```

## 🚀 Performance Optimization

### Critical Indexes
The schema includes strategically placed indexes for optimal query performance:

1. **Test Lookup**: `(repoId, suite, className, name)` - Fast test identification
2. **Failure Clustering**: `(failureMsgSignature, repoId)` - Efficient pattern matching  
3. **Time Series**: `(testId, createdAt)` - Historical analysis
4. **Flakiness Queries**: `(score)` - Quick flaky test identification
5. **Occurrence Tracking**: `(runId, testId)` unique - Prevent duplicates

### Query Patterns
All queries are designed to leverage these indexes:
- Repository dashboard: Uses multiple indexes in parallel
- Flaky test detection: Score index + test lookup
- Historical analysis: Time-series indexes
- Failure clustering: Signature-based indexes

## 📦 Files Included

### Schema & Migrations
- `schema.prisma` - Complete Prisma schema with all models and indexes
- `migrations/20240825000000_add_flakeguard_core_models/` - Migration files
- Migration includes all tables, indexes, and foreign keys

### Data & Examples  
- `seed.ts` - Comprehensive seed script with realistic flakiness patterns
- `sample-queries.ts` - Production-ready query examples
- Query examples cover all major use cases

### Services
- `../src/services/flake-analysis.service.ts` - Complete analysis service
- Implements scoring algorithms, quarantine logic, and clustering

## 🛠️ Usage

### Development Setup
```bash
# Generate Prisma client
npm run generate

# Run migrations
npm run migrate:dev

# Seed with sample data
npm run seed

# Explore with sample queries
npm run sample-queries

# Open Prisma Studio
npm run studio
```

### Production Deployment
```bash
# Deploy migrations
npm run migrate:deploy

# Generate client for production
npm run generate
```

## 🔍 Sample Operations

### Finding Flaky Tests
```typescript
const queries = new FlakeGuardQueries();
const flakyTests = await queries.findFlakiestTests(repoId, 10, 0.3);
```

### Quarantine Management  
```typescript
const service = new FlakeAnalysisService(prisma);
const proposals = await service.generateQuarantineProposals(repoId);
await service.quarantineTest(testId, rationale, 'flakeguard-bot');
```

### Performance Analysis
```typescript
const performance = await queries.analyzeTestRunPerformance(repoId, 7);
// Returns detailed metrics with proper index utilization
```

### Failure Clustering
```typescript
const clusters = await service.clusterFailures(repoId);
// Groups similar failures across tests for root cause analysis
```

## 📊 Data Model Features

### Scalability
- Designed for thousands of repositories and millions of test occurrences
- Efficient batch operations for bulk score updates
- Optimized indexes for common query patterns

### Flexibility
- Multi-provider support (GitHub, GitLab, etc.)
- Configurable scoring algorithms and thresholds  
- Extensible failure pattern matching

### Reliability
- Strong foreign key constraints prevent data corruption
- Cascade deletes maintain referential integrity
- Unique constraints prevent duplicate occurrences

### Observability
- Comprehensive timestamp tracking
- Audit trail for quarantine decisions
- Historical analysis capabilities

## 🎯 Key Algorithms

### Flakiness Scoring
The core scoring algorithm combines:
1. **Basic failure rate**: failures / total_runs
2. **Retry weighting**: Extra weight for fail→pass patterns
3. **Rolling window**: Configurable window size (default 50 runs)
4. **Thresholds**: Warn ≥ 0.3, Quarantine ≥ 0.6

### Failure Clustering
Intelligent grouping using:
1. **Message normalization**: Remove dynamic content (numbers, paths)
2. **Stack trace digesting**: Normalize file paths and line numbers  
3. **Signature generation**: MD5 hash for efficient comparison
4. **Cross-test clustering**: Find similar failures across different tests

### Quarantine Logic
Smart quarantine recommendations:
1. **Impact assessment**: Analyze affected jobs and teams
2. **Duration calculation**: Score-based expiration periods
3. **State management**: Full lifecycle from proposal to resolution
4. **Rollback support**: Easy dismissal and re-evaluation

## 🔧 Configuration

The data model supports configuration through the FlakeAnalysisService:
```typescript
const config = {
  windowSize: 50,              // Rolling window size
  warnThreshold: 0.3,          // Warning threshold
  quarantineThreshold: 0.6,    // Quarantine threshold  
  minOccurrences: 10,          // Minimum runs for analysis
  retryWeightMultiplier: 1.5,  // Extra weight for retries
};
```

## 📈 Monitoring & Metrics

The schema supports comprehensive monitoring:
- Test execution trends over time
- Flakiness distribution across repositories
- Quarantine effectiveness metrics
- Failure pattern evolution
- Team-specific flakiness analysis

## 🔗 Integration Points

### GitHub Actions Workflow
1. **Webhook ingestion** → Create FGWorkflowRun
2. **Artifact parsing** → Create FGOccurrence records  
3. **Score calculation** → Update FGFlakeScore
4. **Check runs** → Query flaky tests for display
5. **Actions** → Execute quarantine decisions

### Slack Integration
1. **Triage commands** → Query repository dashboards
2. **Alert notifications** → New quarantine proposals
3. **Action buttons** → Execute quarantine decisions
4. **Status updates** → Monitor quarantine effectiveness

This data model provides the foundation for FlakeGuard's comprehensive flaky test management system, with production-ready performance and scalability characteristics.