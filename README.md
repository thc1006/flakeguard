# FlakeGuard

A production-grade system for detecting, monitoring, and managing flaky tests in your CI/CD pipeline. FlakeGuard integrates with GitHub Actions to automatically analyze test results, identify flaky tests, and provide actionable recommendations for improving test reliability.

## Features

- **Automated Flake Detection**: Advanced algorithms analyze test execution patterns to identify flaky tests
- **GitHub Integration**: Seamlessly integrates with GitHub Actions via GitHub App
- **JUnit XML Support**: Parses test results from popular testing frameworks (Jest, pytest, JUnit, PHPUnit, etc.)
- **Intelligent Scoring**: Sophisticated flakiness scoring with confidence levels and recommendations
- **Quarantine Management**: Automatically suggest tests for quarantine based on flakiness patterns
- **Real-time Analytics**: Track test reliability trends over time
- **Webhook Processing**: Real-time processing of GitHub events
- **RESTful API**: Complete API for custom integrations

## Quick Start with Docker Compose

### 1. Clone and Setup

```bash
git clone <repository-url>
cd flakeguard
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
```

### 2. Configure Environment

Update your `.env` files with secure secrets:

```bash
# Generate secure keys
JWT_SECRET=$(openssl rand -base64 32)
API_KEY=$(openssl rand -base64 16)

# Update .env files with generated keys
```

### 3. Start Services

```bash
# Start infrastructure (PostgreSQL, Redis)
docker-compose up -d

# Install dependencies
pnpm install

# Setup database
pnpm migrate:dev

# Start development servers
pnpm dev
```

### 4. Verify Installation

- API: http://localhost:3000/health
- Documentation: http://localhost:3000/documentation
- Database GUI: http://localhost:5050 (pgAdmin)

## GitHub App Setup

FlakeGuard operates as a GitHub App to securely access your repositories and process test results.

### 1. Create GitHub App

1. Go to GitHub Settings > Developer settings > GitHub Apps
2. Click "New GitHub App"
3. Fill in the required fields:
   - **App name**: `FlakeGuard-YourOrg` (must be unique)
   - **Homepage URL**: Your FlakeGuard deployment URL
   - **Webhook URL**: `https://your-domain.com/api/github/webhook`
   - **Webhook secret**: Generate a secure random string

### 2. Configure Permissions

Required permissions:
- **Actions**: Read (to access workflow runs and artifacts)
- **Checks**: Write (to create check runs with flake reports)
- **Contents**: Read (to access repository content)
- **Issues**: Write (to create flake reports)
- **Metadata**: Read (required for all apps)
- **Pull requests**: Write (to comment on PRs)

### 3. Subscribe to Events

Required webhook events:
- Check run
- Check suite
- Pull request
- Push
- Workflow job
- Workflow run

### 4. Generate Private Key

1. In your GitHub App settings, scroll to "Private keys"
2. Click "Generate a private key"
3. Download the `.pem` file
4. Add to your environment:

```bash
# In your .env file
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

## Configuration Examples

### Basic Configuration

```typescript
// apps/api/.env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flakeguard"
REDIS_URL="redis://localhost:6379"
NODE_ENV="production"
PORT=3000
LOG_LEVEL="info"

// GitHub App Configuration
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_WEBHOOK_SECRET="your-webhook-secret"

// Security
JWT_SECRET="your-32-character-jwt-secret"
API_KEY="your-16-character-api-key"
```

### Quarantine Policy Configuration

```typescript
// Custom quarantine thresholds
const policy = {
  warnThreshold: 0.3,        // Warn at 30% flakiness
  quarantineThreshold: 0.6,  // Quarantine at 60% flakiness
  minRunsForQuarantine: 5,   // Minimum test runs required
  minRecentFailures: 2,      // Recent failures required
  lookbackDays: 14,          // Days to analyze
  rollingWindowSize: 50      // Number of recent runs to analyze
};
```

## Architecture

FlakeGuard follows a modern microservices architecture:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   GitHub App    │    │    API Server   │    │     Worker      │
│   (Webhooks)    │───▶│    (Fastify)    │───▶│   (BullMQ)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   PostgreSQL    │    │      Redis      │
                       │   (Test Data)   │    │    (Queue)      │
                       └─────────────────┘    └─────────────────┘
```

### Core Components

- **API Server**: Fastify-based REST API handling GitHub webhooks and API requests
- **Worker Service**: Background job processor for test analysis and flake detection
- **PostgreSQL**: Persistent storage for test results, flake detections, and metadata
- **Redis**: Job queue and caching layer

## Tech Stack

- **Runtime**: Node.js 20+
- **Package Manager**: pnpm 8+
- **Language**: TypeScript 5.3
- **API Framework**: Fastify 4
- **Database ORM**: Prisma 5
- **Database**: PostgreSQL 16
- **Queue**: BullMQ with Redis 7
- **Validation**: Zod
- **Logging**: Pino
- **Testing**: Vitest
- **Linting**: ESLint + Prettier

## API Usage

### Analyze Test Results

```typescript
// Submit JUnit XML for analysis
const response = await fetch('/api/ingestion/junit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/xml',
    'Authorization': `Bearer ${token}`,
    'X-Repository-Id': 'owner/repo',
    'X-Run-Id': 'workflow-run-123'
  },
  body: junitXmlContent
});
```

### Generate Quarantine Plan

```typescript
// Get quarantine recommendations
const plan = await fetch('/api/quarantine/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    repositoryId: 'owner/repo',
    lookbackDays: 14,
    policy: {
      quarantineThreshold: 0.6,
      minRunsForQuarantine: 5
    }
  })
});
```

## Workflow Integration

### GitHub Actions Workflow

```yaml
name: Test with FlakeGuard
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Tests
        run: |
          npm test -- --reporter=junit --outputFile=test-results.xml
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results.xml
          
      # FlakeGuard automatically processes artifacts via webhooks
```

## Development Scripts

### Root Level

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run tests for all packages |
| `pnpm lint` | Lint all TypeScript files |
| `pnpm lint:fix` | Auto-fix linting issues |
| `pnpm format` | Format code with Prettier |
| `pnpm typecheck` | Type-check all packages |
| `pnpm clean` | Clean all build artifacts |
| `pnpm migrate:dev` | Run database migrations (development) |
| `pnpm migrate:deploy` | Run database migrations (production) |

### API Specific

```bash
cd apps/api
pnpm studio     # Open Prisma Studio for database GUI
pnpm generate   # Generate Prisma client
pnpm test:github # Run GitHub integration tests
```

## Monitoring and Observability

FlakeGuard provides comprehensive monitoring:

- **Health Checks**: `/health` and `/health/ready` endpoints
- **Metrics**: Prometheus-compatible metrics at `/metrics`
- **Structured Logging**: JSON logs with correlation IDs
- **Request Tracing**: Distributed tracing support

## Security Features

- **Webhook Signature Validation**: HMAC-SHA256 signature verification
- **Rate Limiting**: Configurable per-endpoint rate limits
- **CORS Protection**: Configurable CORS policies
- **Input Validation**: Zod schema validation for all inputs
- **Secure Headers**: Helmet.js security headers

## Documentation

- [Architecture Overview](docs/architecture.md)
- [API Reference](docs/api-reference.md)
- [GitHub App Setup Guide](docs/github-app-setup.md)
- [Slack Integration](docs/slack-integration.md)
- [Scoring Algorithm](docs/scoring-algorithm.md)
- [Troubleshooting](docs/troubleshooting.md)

## Production Deployment

### Environment Variables

Required for production:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/flakeguard
REDIS_URL=redis://host:6379
JWT_SECRET=your-secure-32-character-secret
API_KEY=your-secure-16-character-key
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

### Build and Deploy

```bash
# Build for production
pnpm build

# Run database migrations
pnpm migrate:deploy

# Start services
cd apps/api && pnpm start &
cd apps/worker && pnpm start &
```

### Docker Production

```bash
# Build production images
docker build -f apps/api/Dockerfile -t flakeguard-api .
docker build -f apps/worker/Dockerfile -t flakeguard-worker .

# Run with docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Support

- **Documentation**: [docs.flakeguard.dev](https://docs.flakeguard.dev)
- **Issues**: [GitHub Issues](https://github.com/flakeguard/flakeguard/issues)
- **Security**: See [SECURITY.md](SECURITY.md)
- **Code of Conduct**: See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**FlakeGuard** - Making your tests more reliable, one flake at a time.