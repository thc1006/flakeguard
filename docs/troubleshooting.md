# FlakeGuard Troubleshooting Guide

This comprehensive troubleshooting guide helps you diagnose and resolve common issues with FlakeGuard installation, configuration, and operation.

## Quick Diagnostics

### Health Check Commands

```bash
# Check API health
curl http://localhost:3000/health

# Check readiness (includes database connectivity)
curl http://localhost:3000/health/ready

# Check all services
docker-compose ps

# View logs
docker-compose logs -f api worker postgres redis
```

### System Status

```bash
# Check FlakeGuard processes
ps aux | grep -E "(flakeguard|fastify|bullmq)"

# Check port usage
netstat -tlnp | grep -E ":300[0-9]|:543[0-9]|:637[0-9]"

# Check disk space
df -h

# Check memory usage
free -h
```

## Installation Issues

### 1. Docker Compose Startup Failures

#### Problem: Services fail to start

**Symptoms:**
```bash
ERROR: Service 'postgres' failed to build
ERROR: Port 5432 is already in use
```

**Solutions:**

```bash
# Check for port conflicts
sudo lsof -i :5432  # PostgreSQL
sudo lsof -i :6379  # Redis  
sudo lsof -i :3000  # API server

# Stop conflicting services
sudo systemctl stop postgresql
sudo systemctl stop redis-server

# Or change ports in docker-compose.yml
services:
  postgres:
    ports:
      - "5433:5432"  # Use different external port
  redis:
    ports:
      - "6380:6379"  # Use different external port
```

#### Problem: Permission denied errors

**Symptoms:**
```bash
ERROR: Permission denied while trying to connect to Docker daemon
mkdir: cannot create directory: Permission denied
```

**Solutions:**

```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Fix file permissions
sudo chown -R $(whoami):$(whoami) .
```

### 2. Node.js and pnpm Issues

#### Problem: Node version incompatibility

**Symptoms:**
```bash
error Unsupported Node version
The engine "node" is incompatible with this module
```

**Solutions:**

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or use Node Version Manager
nvm install 20
nvm use 20

# Verify version
node --version  # Should be v20.x.x
```

#### Problem: pnpm command not found

**Solutions:**

```bash
# Install pnpm globally
npm install -g pnpm

# Or use Node.js corepack
corepack enable
corepack prepare pnpm@latest --activate

# Verify installation
pnpm --version  # Should be 8.x.x or higher
```

### 3. Database Migration Failures

#### Problem: Migration command fails

**Symptoms:**
```bash
Error: P1001: Can't reach database server at localhost:5432
Migration failed: relation "users" already exists
```

**Solutions:**

```bash
# Check database connectivity
psql -h localhost -U postgres -d flakeguard -c "SELECT 1;"

# Reset database (CAUTION: Destroys data)
pnpm --filter=@flakeguard/api migrate:reset

# Or manually fix migrations
psql -h localhost -U postgres -d flakeguard -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pnpm --filter=@flakeguard/api migrate:deploy
```

## Configuration Issues

### 1. Environment Variable Problems

#### Problem: Required environment variables missing

**Symptoms:**
```bash
Error: Missing required environment variable: JWT_SECRET
Config validation failed: Invalid JWT_SECRET length
```

**Solutions:**

```bash
# Generate secure secrets
JWT_SECRET=$(openssl rand -base64 32)
API_KEY=$(openssl rand -base64 16)

# Update .env file
echo "JWT_SECRET=$JWT_SECRET" >> .env
echo "API_KEY=$API_KEY" >> .env

# Verify environment
cat .env | grep -E "(JWT_SECRET|API_KEY)"
```

#### Problem: Database URL format issues

**Symptoms:**
```bash
Error: Invalid DATABASE_URL format
Connection refused to database
```

**Solutions:**

```bash
# Correct DATABASE_URL format
DATABASE_URL="postgresql://username:password@host:port/database?schema=public"

# Example for local development
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flakeguard?schema=public"

# For Docker Compose (use service name)
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/flakeguard?schema=public"

# Test connection
psql "$DATABASE_URL" -c "SELECT version();"
```

### 2. GitHub App Configuration Issues

#### Problem: Webhook signature validation fails

**Symptoms:**
```bash
Error: Invalid webhook signature
GitHub webhook delivery failed
```

**Solutions:**

```bash
# Verify webhook secret matches
echo "GITHUB_WEBHOOK_SECRET in .env: $GITHUB_WEBHOOK_SECRET"
# Compare with GitHub App settings

# Test signature validation
curl -X POST http://localhost:3000/api/github/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-Hub-Signature-256: sha256=$(echo -n '{"test":"data"}' | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" -binary | xxd -p -c 256)" \
  -d '{"test":"data"}'
```

#### Problem: GitHub App authentication fails

**Symptoms:**
```bash
Error: Bad credentials
GitHub API rate limit exceeded
```

**Solutions:**

```bash
# Verify private key format
head -1 github-private-key.pem  # Should start with -----BEGIN RSA PRIVATE KEY-----
tail -1 github-private-key.pem  # Should end with -----END RSA PRIVATE KEY-----

# Test JWT generation
node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const privateKey = fs.readFileSync('github-private-key.pem');
const payload = {
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + (10 * 60),
  iss: process.env.GITHUB_APP_ID
};
const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
console.log('JWT:', token);
"
```

## Runtime Issues

### 1. API Server Problems

#### Problem: Server fails to start

**Symptoms:**
```bash
Error: EADDRINUSE: address already in use :::3000
TypeError: Cannot read property 'connect' of undefined
```

**Solutions:**

```bash
# Find process using port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 npm run dev

# Check for missing dependencies
pnpm install

# Clear node_modules if needed
rm -rf node_modules
pnpm install
```

#### Problem: Database connection pool exhausted

**Symptoms:**
```bash
Error: Connection pool exhausted
Too many clients already
```

**Solutions:**

```typescript
// Increase connection pool size in Prisma schema
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["jsonProtocol"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}

// Or in connection string
DATABASE_URL="postgresql://user:pass@host:port/db?connection_limit=20&pool_timeout=20"
```

### 2. Worker Service Issues

#### Problem: Jobs not processing

**Symptoms:**
```bash
Jobs stuck in queue
Worker process consuming high CPU
Redis connection timeouts
```

**Solutions:**

```bash
# Check Redis connectivity
redis-cli ping

# Monitor job queue
redis-cli -h localhost -p 6379 monitor

# Check worker logs
docker-compose logs -f worker

# Restart worker service
docker-compose restart worker

# Clear stuck jobs (CAUTION)
redis-cli FLUSHALL
```

#### Problem: Memory leaks in worker

**Symptoms:**
```bash
Worker process memory usage increasing
Out of memory errors
```

**Solutions:**

```typescript
// Add memory monitoring
process.on('warning', (warning) => {
  console.warn('Warning:', warning.name);
  console.warn(warning.message);
  console.warn(warning.stack);
});

// Implement job concurrency limits
const worker = new Worker('job-queue', processor, {
  concurrency: 5,  // Limit concurrent jobs
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 3,
  },
});
```

### 3. GitHub Integration Issues

#### Problem: Webhooks not being received

**Symptoms:**
```bash
No webhook events in logs
GitHub shows failed deliveries
```

**Solutions:**

```bash
# Test webhook endpoint publicly accessible
curl -I https://your-domain.com/api/github/webhook

# Check firewall/security groups
# - Port 443 must be open
# - SSL certificate must be valid
# - No IP restrictions that block GitHub

# Verify webhook URL in GitHub App settings
echo "Webhook URL should be: https://your-domain.com/api/github/webhook"

# Test with ngrok for development
ngrok http 3000
# Update GitHub webhook URL to ngrok URL
```

#### Problem: Check runs not being created

**Symptoms:**
```bash
API calls succeed but no check runs appear
GitHub App installation issues
```

**Solutions:**

```bash
# Verify GitHub App permissions
# - Checks: Write
# - Actions: Read  
# - Contents: Read

# Check installation status
curl -H "Authorization: Bearer $GITHUB_JWT" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/app/installations

# Test check run creation
curl -X POST \
     -H "Authorization: Bearer $INSTALLATION_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/repos/OWNER/REPO/check-runs \
     -d '{"name":"Test Check","head_sha":"SHA"}'
```

## Performance Issues

### 1. Slow Test Result Processing

#### Problem: JUnit XML parsing is slow

**Symptoms:**
```bash
High CPU usage during ingestion
Timeout errors on large XML files
```

**Solutions:**

```typescript
// Optimize parsing configuration
const parserOptions = {
  streamOptions: {
    highWaterMark: 64 * 1024,  // 64KB buffer
  },
  maxFileSize: 50 * 1024 * 1024,  // 50MB limit
  maxElementDepth: 100,
  timeout: 30000,  // 30 second timeout
};

// Add memory monitoring
process.memoryUsage(); // Monitor during parsing
```

```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm start

# Process files in smaller batches
# Split large XML files before processing
```

### 2. Database Query Performance

#### Problem: Slow analytical queries

**Symptoms:**
```bash
Quarantine plan generation takes >30 seconds
High database CPU usage
```

**Solutions:**

```sql
-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_test_results_analysis 
ON test_results (repository_id, test_full_name, created_at DESC, status);

CREATE INDEX CONCURRENTLY idx_test_results_flake_scoring
ON test_results (repository_id, status, created_at DESC) 
WHERE status IN ('failed', 'passed');

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM test_results 
WHERE repository_id = 'owner/repo' 
ORDER BY created_at DESC 
LIMIT 1000;
```

```typescript
// Optimize queries with pagination
const results = await prisma.testResult.findMany({
  where: { repositoryId },
  orderBy: { createdAt: 'desc' },
  take: 1000,  // Limit results
  skip: offset,
});

// Use connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${DATABASE_URL}?connection_limit=20&pool_timeout=20`
    }
  }
});
```

## Security Issues

### 1. Authentication Problems

#### Problem: JWT token validation fails

**Symptoms:**
```bash
Error: Invalid token signature
Token expired errors
```

**Solutions:**

```typescript
// Verify JWT configuration
const jwtConfig = {
  secret: process.env.JWT_SECRET,  // Must be 32+ characters
  expiresIn: '1h',
  issuer: 'flakeguard',
  algorithm: 'HS256',
};

// Test token generation/validation
const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: 123 }, jwtConfig.secret, jwtConfig);
const decoded = jwt.verify(token, jwtConfig.secret);
console.log('Token valid:', decoded);
```

### 2. CORS Configuration Issues

#### Problem: CORS errors in browser

**Symptoms:**
```bash
Access to fetch blocked by CORS policy
Preflight request doesn't pass
```

**Solutions:**

```typescript
// Configure CORS properly
await app.register(require('@fastify/cors'), {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://your-frontend-domain.com']
    : true,  // Allow all in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});
```

## Monitoring and Debugging

### 1. Enable Debug Logging

```bash
# Environment variables for debug mode
DEBUG=true
LOG_LEVEL=debug
NODE_ENV=development

# Specific debug categories
DEBUG=flakeguard:*
DEBUG=flakeguard:github,flakeguard:scoring
```

### 2. Health Monitoring Setup

```typescript
// Add comprehensive health checks
app.get('/health/detailed', async (request, reply) => {
  const checks = {
    database: await checkDatabaseHealth(),
    redis: await checkRedisHealth(), 
    github: await checkGitHubHealth(),
    diskSpace: await checkDiskSpace(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  };
  
  return { status: 'healthy', checks, timestamp: new Date().toISOString() };
});
```

### 3. Error Tracking

```typescript
// Add error tracking with context
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Send to error tracking service
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Send to error tracking service
});
```

## Getting Help

### 1. Collect Debug Information

```bash
# System information
echo "OS: $(uname -a)"
echo "Node: $(node --version)"  
echo "pnpm: $(pnpm --version)"
echo "Docker: $(docker --version)"

# Service status
docker-compose ps
docker-compose logs --tail=50 api worker

# Configuration (sanitized)
grep -v -E "(SECRET|KEY|PASSWORD)" .env
```

### 2. Create Minimal Reproduction

```typescript
// Minimal test case for issues
const request = require('supertest');
const app = require('../src/app');

describe('Issue reproduction', () => {
  it('reproduces the problem', async () => {
    const response = await request(app)
      .post('/api/ingestion/junit')
      .set('Content-Type', 'application/xml')
      .send('<testsuite><testcase name="test1" status="passed"/></testsuite>');
    
    expect(response.status).toBe(201);
  });
});
```

### 3. Support Channels

- **GitHub Issues**: [Report bugs and feature requests](https://github.com/flakeguard/flakeguard/issues)
- **Documentation**: [Complete documentation](https://docs.flakeguard.dev)
- **Community**: [Discord server](https://discord.gg/flakeguard)
- **Security**: [Security reporting](mailto:security@flakeguard.dev)

### 4. Professional Support

For enterprise deployments:
- **Priority support**: Dedicated support channels
- **Custom configuration**: Tailored setup assistance  
- **Performance tuning**: Optimization consultations
- **Training**: Team onboarding and best practices

Contact: support@flakeguard.dev

This troubleshooting guide covers the most common issues encountered with FlakeGuard. If your issue isn't covered here, please check the documentation or reach out to the community for assistance.