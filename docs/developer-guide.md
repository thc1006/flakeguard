# FlakeGuard Developer Guide

This guide provides comprehensive information for developers working on FlakeGuard, including local development setup, testing strategies, code architecture, and contribution workflows.

## Table of Contents

- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Core Technologies](#core-technologies)
- [Development Workflow](#development-workflow)
- [Testing Strategy](#testing-strategy)
- [Code Style and Standards](#code-style-and-standards)
- [Database Development](#database-development)
- [API Development](#api-development)
- [GitHub Integration](#github-integration)
- [Performance Optimization](#performance-optimization)
- [Debugging and Logging](#debugging-and-logging)
- [Deployment Guide](#deployment-guide)
- [Contributing](#contributing)

## Development Environment

### Prerequisites

```bash
# Required software
- Node.js 20+ (use nvm or fnm)
- pnpm 8+
- Docker & Docker Compose
- Git
- PostgreSQL client (psql)
- Redis client (redis-cli)

# Optional but recommended
- VS Code with extensions:
  - TypeScript and JavaScript Language Features
  - Prisma
  - ESLint
  - Prettier
  - Thunder Client (API testing)
```

### Initial Setup

```bash
# Clone repository
git clone https://github.com/flakeguard/flakeguard.git
cd flakeguard

# Install dependencies
pnpm install

# Setup environment files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env

# Generate secure secrets
JWT_SECRET=$(openssl rand -base64 32)
API_KEY=$(openssl rand -base64 16)

# Update .env files with generated secrets
echo "JWT_SECRET=$JWT_SECRET" >> .env
echo "API_KEY=$API_KEY" >> .env

# Start infrastructure
docker-compose up -d postgres redis

# Setup database
pnpm migrate:dev
pnpm --filter=@flakeguard/api generate

# Start development servers
pnpm dev
```

### Development Scripts

```bash
# Development
pnpm dev                    # Start all services in watch mode
pnpm dev:api               # Start only API server
pnpm dev:worker            # Start only worker service

# Building
pnpm build                 # Build all packages
pnpm build:api             # Build API server only
pnpm build:worker          # Build worker only

# Testing
pnpm test                  # Run all tests
pnpm test:watch            # Run tests in watch mode  
pnpm test:coverage         # Generate coverage report
pnpm test:api              # Run API tests only
pnpm test:worker           # Run worker tests only
pnpm test:integration      # Run integration tests
pnpm test:e2e              # Run end-to-end tests

# Code Quality
pnpm lint                  # Run ESLint
pnpm lint:fix              # Fix ESLint issues
pnpm format                # Format with Prettier
pnpm typecheck             # TypeScript type checking

# Database
pnpm migrate:dev           # Run dev migrations
pnpm migrate:reset         # Reset database (destructive)
pnpm studio                # Open Prisma Studio
pnpm generate              # Generate Prisma client
```

## Project Structure

```
flakeguard/
├── apps/
│   ├── api/                    # Fastify API server
│   │   ├── src/
│   │   │   ├── server.ts       # Application entry point
│   │   │   ├── app.ts          # Fastify app configuration
│   │   │   ├── config/         # Configuration management
│   │   │   ├── plugins/        # Fastify plugins
│   │   │   ├── routes/         # API route handlers
│   │   │   ├── github/         # GitHub App integration
│   │   │   ├── ingestion/      # Test result ingestion
│   │   │   ├── analytics/      # Flakiness analysis
│   │   │   └── utils/          # Utility functions
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema
│   │   └── package.json
│   │
│   └── worker/                 # Background job processor
│       ├── src/
│       │   ├── index.ts        # Worker entry point
│       │   ├── processors/     # Job processors
│       │   └── utils/          # Worker utilities
│       └── package.json
│
├── packages/
│   └── shared/                 # Shared types and utilities
│       ├── src/
│       │   ├── types/          # TypeScript definitions
│       │   ├── schemas/        # Zod validation schemas
│       │   ├── constants/      # Shared constants
│       │   └── utils/          # Shared utilities
│       └── package.json
│
├── docs/                       # Documentation
├── docker-compose.yml          # Development infrastructure
├── pnpm-workspace.yaml         # pnpm workspace config
└── package.json                # Root package.json
```

## Core Technologies

### Backend Stack

**Fastify Framework**
```typescript
// Example Fastify route with proper typing
export async function registerUserRoutes(app: FastifyInstance) {
  app.get('/users', {
    schema: {
      response: {
        200: userListSchema
      }
    }
  }, async (request, reply) => {
    const users = await app.prisma.user.findMany();
    return { users };
  });
}
```

**Prisma ORM**
```typescript
// Example model usage
const testResult = await prisma.testResult.create({
  data: {
    name: 'testUserLogin',
    suite: 'integration',
    status: 'failed',
    time: 2.5,
    repository: {
      connect: { id: repositoryId }
    }
  },
  include: {
    repository: true,
    testSuite: true
  }
});
```

**BullMQ Job Processing**
```typescript
// Example job processor
export class TestAnalysisProcessor {
  async process(job: Job<TestAnalysisJobData>): Promise<void> {
    const { repositoryId, testResultIds } = job.data;
    
    try {
      const results = await this.fetchTestResults(testResultIds);
      const analysis = await this.analyzeFlakiness(results);
      
      await this.storeAnalysisResults(repositoryId, analysis);
      
      // Update job progress
      await job.updateProgress(100);
    } catch (error) {
      logger.error('Test analysis failed', { error, jobId: job.id });
      throw error;
    }
  }
}
```

### Type Safety

**Zod Schemas**
```typescript
// Define schemas for runtime validation
export const createTestResultSchema = z.object({
  name: z.string().min(1),
  suite: z.string().min(1),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  time: z.number().min(0),
  message: z.string().optional(),
  stack: z.string().optional(),
});

export type CreateTestResultInput = z.infer<typeof createTestResultSchema>;
```

**TypeScript Configuration**
```typescript
// Strict TypeScript settings
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noImplicitThis": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Development Workflow

### Feature Development Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/flake-detection-improvement
   ```

2. **Make Changes**
   - Write code following style guidelines
   - Add comprehensive tests
   - Update documentation

3. **Run Quality Checks**
   ```bash
   pnpm lint:fix
   pnpm typecheck
   pnpm test
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: improve flake detection accuracy

   - Add retry pattern analysis
   - Implement message normalization
   - Update scoring algorithm weights"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/flake-detection-improvement
   # Create pull request via GitHub UI
   ```

### Code Review Guidelines

**For Authors:**
- Self-review code before submitting
- Write descriptive PR descriptions
- Include test results and performance impact
- Address all feedback promptly

**For Reviewers:**
- Focus on functionality, performance, and maintainability
- Check test coverage and edge cases
- Verify TypeScript types are correct
- Ensure documentation is updated

## Testing Strategy

### Test Pyramid Structure

```
      E2E Tests (Few)
   ┌─────────────────┐
   │ Integration     │
   │ Tests (Some)    │
   └─────────────────┘
  ┌───────────────────┐
  │ Unit Tests (Many) │
  └───────────────────┘
```

### Unit Tests

```typescript
// Example unit test with proper mocking
describe('FlakinessScorer', () => {
  let scorer: FlakinessScorer;
  
  beforeEach(() => {
    scorer = new FlakinessScorer({
      quarantineThreshold: 0.6,
      minRunsForQuarantine: 5
    });
  });
  
  describe('computeFlakeScore', () => {
    it('should return high score for intermittent failures', () => {
      const runs = [
        mockTestRun({ status: 'failed' }),
        mockTestRun({ status: 'passed' }),
        mockTestRun({ status: 'failed' }),
        mockTestRun({ status: 'passed' }),
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.recommendation.action).toBe('investigate');
    });
    
    it('should return low score for consistently passing tests', () => {
      const runs = Array(10).fill(null).map(() => 
        mockTestRun({ status: 'passed' })
      );
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.score).toBeLessThan(0.1);
      expect(result.recommendation.action).toBe('stable');
    });
  });
});
```

### Integration Tests

```typescript
// Example integration test
describe('JUnit Ingestion Integration', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.prisma;
  });
  
  afterAll(async () => {
    await app.close();
  });
  
  it('should ingest JUnit XML and create test results', async () => {
    const junitXml = readFileSync('fixtures/junit-results.xml', 'utf8');
    
    const response = await app.inject({
      method: 'POST',
      url: '/api/ingestion/junit',
      headers: {
        'Content-Type': 'application/xml',
        'X-Repository-Id': 'test/repo',
        'X-Run-Id': 'run-123'
      },
      payload: junitXml
    });
    
    expect(response.statusCode).toBe(201);
    
    const testResults = await prisma.testResult.findMany({
      where: { runId: 'run-123' }
    });
    
    expect(testResults).toHaveLength(42);
    expect(testResults[0]).toMatchObject({
      name: expect.any(String),
      status: expect.stringMatching(/passed|failed|skipped|error/),
      time: expect.any(Number)
    });
  });
});
```

### End-to-End Tests

```typescript
// Example E2E test with GitHub API mocking
describe('GitHub Integration E2E', () => {
  beforeEach(() => {
    // Mock GitHub API responses
    nock('https://api.github.com')
      .post('/repos/test/repo/check-runs')
      .reply(201, mockCheckRunResponse);
  });
  
  it('should complete full workflow from webhook to check run', async () => {
    // Send workflow_run webhook
    await sendWebhook({
      event: 'workflow_run',
      payload: mockWorkflowRunPayload
    });
    
    // Wait for processing
    await waitForJobCompletion();
    
    // Verify check run was created
    const checkRuns = await prisma.checkRun.findMany({
      where: { repositoryId: 'test/repo' }
    });
    
    expect(checkRuns).toHaveLength(1);
    expect(checkRuns[0].name).toBe('FlakeGuard Analysis');
  });
});
```

## Code Style and Standards

### ESLint Configuration

```json
{
  "extends": [
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "prefer-const": "error",
    "no-console": "warn"
  }
}
```

### Prettier Configuration

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

### Naming Conventions

```typescript
// Variables and functions: camelCase
const testResults = await fetchTestResults();
const analyzeFlakiness = (results: TestResult[]) => { ... };

// Types and interfaces: PascalCase
interface FlakeDetectionResult {
  isFlaky: boolean;
  confidence: number;
}

// Constants: SCREAMING_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30000;

// File names: kebab-case
// flake-detector.ts, junit-parser.ts, github-integration.ts
```

## Database Development

### Schema Design Principles

```prisma
// Use descriptive model names
model TestResult {
  id           String   @id @default(cuid())
  name         String   // Clear, concise field names
  status       String   // Use enums where possible
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  // Clear relationships
  repository   Repository @relation(fields: [repositoryId], references: [id])
  repositoryId String
  
  // Performance indexes
  @@index([repositoryId, createdAt])
  @@index([status])
}
```

### Migration Best Practices

```bash
# Create descriptive migration names
pnpm migrate:dev --name add_flake_detection_confidence_scoring

# Always test migrations on sample data
pnpm migrate:dev
# Test with production-like data volume

# Use shadow database for validation
pnpm migrate:diff --from-schema-datamodel prisma/schema.prisma
```

### Query Optimization

```typescript
// Use proper indexes and query patterns
const recentFlakyCandidates = await prisma.testResult.findMany({
  where: {
    repositoryId,
    createdAt: {
      gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
    },
    status: {
      in: ['failed', 'error']
    }
  },
  include: {
    repository: true,
    testSuite: {
      select: { name: true }
    }
  },
  orderBy: {
    createdAt: 'desc'
  },
  take: 1000 // Limit results
});
```

## API Development

### Route Organization

```typescript
// Group related routes in logical modules
// apps/api/src/routes/quarantine.ts
export async function quarantineRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate); // Auth for all routes
  
  app.post('/plan', {
    schema: {
      body: generateQuarantinePlanSchema,
      response: {
        200: quarantinePlanResponseSchema
      }
    }
  }, generateQuarantinePlanHandler);
  
  app.get('/policy', {
    schema: {
      response: {
        200: quarantinePolicySchema
      }
    }
  }, getQuarantinePolicyHandler);
}
```

### Error Handling

```typescript
// Consistent error handling pattern
export class FlakeGuardError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'FlakeGuardError';
  }
}

// Usage in handlers
export async function generateQuarantinePlan(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const plan = await quarantineService.generatePlan(request.body);
    return reply.code(200).send({
      success: true,
      data: plan
    });
  } catch (error) {
    if (error instanceof FlakeGuardError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }
    throw error; // Let global error handler catch
  }
}
```

## GitHub Integration

### Authentication Flow

```typescript
// GitHub App authentication helper
export class GitHubAuthManager {
  private readonly app: App;
  
  constructor(appId: string, privateKey: string) {
    this.app = new App({ appId, privateKey });
  }
  
  async getInstallationOctokit(installationId: number): Promise<Octokit> {
    return await this.app.getInstallationOctokit(installationId);
  }
  
  async createCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    options: CheckRunOptions
  ): Promise<CheckRunResponse> {
    const octokit = await this.getInstallationOctokit(installationId);
    
    return await octokit.rest.checks.create({
      owner,
      repo,
      ...options
    });
  }
}
```

### Webhook Processing

```typescript
// Webhook handler pattern
export class WorkflowRunProcessor extends BaseWebhookProcessor {
  async process(payload: WorkflowRunWebhookPayload): Promise<void> {
    const { workflow_run, repository, installation } = payload;
    
    if (workflow_run.conclusion !== 'completed') {
      return; // Only process completed workflows
    }
    
    try {
      // Store workflow run data
      await this.storeWorkflowRun(workflow_run, repository, installation);
      
      // Queue artifact analysis
      await this.queueArtifactAnalysis({
        workflowRunId: workflow_run.id,
        repositoryId: repository.full_name,
        installationId: installation.id
      });
      
      this.logger.info('Workflow run processed', {
        workflowRunId: workflow_run.id,
        repository: repository.full_name,
        conclusion: workflow_run.conclusion
      });
    } catch (error) {
      this.logger.error('Failed to process workflow run', {
        error,
        workflowRunId: workflow_run.id
      });
      throw error;
    }
  }
}
```

## Performance Optimization

### Database Optimization

```typescript
// Connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${DATABASE_URL}?connection_limit=20&pool_timeout=20&socket_timeout=20`
    }
  }
});

// Query optimization
const getTestAnalytics = async (repositoryId: string, days: number = 30) => {
  // Use database views for complex analytics
  return await prisma.$queryRaw`
    SELECT 
      suite_name,
      COUNT(*) as total_tests,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_tests,
      AVG(execution_time) as avg_time
    FROM test_analytics_view 
    WHERE repository_id = ${repositoryId}
      AND created_at >= NOW() - INTERVAL '${days} days'
    GROUP BY suite_name
    ORDER BY failed_tests DESC
  `;
};
```

### Memory Management

```typescript
// Streaming for large datasets
export async function* processLargeJUnitFile(
  filePath: string
): AsyncGenerator<TestResult, void, unknown> {
  const stream = createReadStream(filePath);
  const parser = createJUnitStreamParser();
  
  for await (const chunk of pipeline(stream, parser)) {
    yield chunk; // Process one test result at a time
  }
}

// Use it in processing
for await (const testResult of processLargeJUnitFile(xmlPath)) {
  await processTestResult(testResult);
  
  // Prevent memory buildup
  if (process.memoryUsage().heapUsed > MAX_HEAP_SIZE) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

## Debugging and Logging

### Structured Logging

```typescript
// Use structured logging with context
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) {
      return { level: label };
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Usage with context
logger.info('Processing test results', {
  repositoryId: 'owner/repo',
  testCount: 42,
  processingTimeMs: 150,
  correlationId: 'req-123'
});
```

### Debug Configuration

```bash
# Enable debug logging
DEBUG=flakeguard:* pnpm dev

# Specific modules
DEBUG=flakeguard:github,flakeguard:scoring pnpm dev

# Environment-based logging
LOG_LEVEL=debug pnpm dev
```

### Performance Monitoring

```typescript
// Add performance monitoring
export class PerformanceMonitor {
  static async measure<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const start = performance.now();
    
    try {
      const result = await operation();
      const duration = performance.now() - start;
      
      logger.info('Operation completed', {
        operation: operationName,
        durationMs: Math.round(duration),
        success: true
      });
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      logger.error('Operation failed', {
        operation: operationName,
        durationMs: Math.round(duration),
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }
}
```

## Deployment Guide

### Environment Configuration

```bash
# Production environment variables
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@prod-host:5432/flakeguard
REDIS_URL=redis://prod-host:6379
JWT_SECRET=your-production-jwt-secret-32-chars-minimum
API_KEY=your-production-api-key-16-chars-minimum
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret
LOG_LEVEL=info
```

### Docker Production Build

```dockerfile
# Multi-stage production build
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@8

FROM base AS deps
COPY package*.json pnpm-workspace.yaml ./
COPY apps/api/package*.json ./apps/api/
COPY apps/worker/package*.json ./apps/worker/
COPY packages/shared/package*.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/apps/api/server.js"]
```

### Health Checks

```typescript
// Comprehensive health checks for production
export async function healthCheck(): Promise<HealthStatus> {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkGitHubAPI(),
    checkDiskSpace(),
    checkMemoryUsage()
  ]);
  
  const results = checks.map((check, index) => ({
    name: ['database', 'redis', 'github', 'disk', 'memory'][index],
    healthy: check.status === 'fulfilled',
    details: check.status === 'fulfilled' ? check.value : check.reason
  }));
  
  const allHealthy = results.every(result => result.healthy);
  
  return {
    status: allHealthy ? 'healthy' : 'unhealthy',
    checks: results,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version
  };
}
```

## Contributing

### Pull Request Process

1. **Fork and Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Develop and Test**
   - Write comprehensive tests
   - Follow coding standards
   - Update documentation

3. **Quality Checks**
   ```bash
   pnpm lint:fix
   pnpm typecheck
   pnpm test
   pnpm build
   ```

4. **Commit with Convention**
   ```bash
   # Conventional Commits format
   git commit -m "feat: add flake detection confidence scoring
   
   - Implement confidence calculation based on data quality
   - Add time span and quantity factors
   - Update recommendation engine to use confidence
   
   Closes #123"
   ```

5. **Create Pull Request**
   - Clear description of changes
   - Link related issues
   - Include test results
   - Add screenshots if UI changes

### Code Review Checklist

**Functionality:**
- [ ] Code solves the intended problem
- [ ] Edge cases are handled properly
- [ ] Error handling is comprehensive

**Performance:**
- [ ] No obvious performance issues
- [ ] Database queries are optimized
- [ ] Memory usage is reasonable

**Security:**
- [ ] Input validation is present
- [ ] No security vulnerabilities
- [ ] Authentication/authorization is correct

**Maintainability:**
- [ ] Code is readable and well-documented
- [ ] Functions are single-purpose
- [ ] TypeScript types are correct

**Testing:**
- [ ] Adequate test coverage
- [ ] Tests are meaningful and thorough
- [ ] Integration tests cover workflows

This developer guide provides the foundation for effective development on FlakeGuard, ensuring code quality, performance, and maintainability while following best practices for modern TypeScript applications.