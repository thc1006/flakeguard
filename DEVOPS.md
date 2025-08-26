# FlakeGuard DevOps Infrastructure

This document describes the DevOps infrastructure and deployment processes for FlakeGuard.

## Overview

FlakeGuard uses a modern DevOps stack with containerized services, automated CI/CD pipelines, comprehensive monitoring, and infrastructure as code principles.

## Quick Start

### Development Environment

1. **Prerequisites**
   - Node.js 20+
   - pnpm 8.15.1+
   - Docker & Docker Compose
   - Git

2. **Setup**
   ```bash
   # Clone and setup
   git clone <repository>
   cd flakeguard
   cp .env.example .env
   
   # Install dependencies
   pnpm install
   
   # Start infrastructure
   docker-compose up -d postgres redis
   
   # Run migrations
   pnpm migrate:dev
   
   # Seed development data (optional)
   ./scripts/seed-data.sh development
   
   # Start development services
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
   ```

3. **Access Services**
   - API: http://localhost:3000
   - Web: http://localhost:3002
   - Proxy: http://localhost:8080
   - Database: localhost:5432
   - Redis: localhost:6379

### One-Command Deployment

```bash
# Development with monitoring and seed data
./scripts/deploy.sh --environment development --monitoring --seed-data

# Staging deployment
./scripts/deploy.sh --environment staging --tag v1.2.3

# Production deployment
./scripts/deploy.sh --environment production --tag v1.2.3
```

## Architecture

### Services

- **API** (`apps/api`): Backend REST API service
- **Web** (`apps/web`): Frontend React application
- **Worker** (`apps/worker`): Background job processor
- **PostgreSQL**: Primary database
- **Redis**: Cache and job queue
- **Prometheus**: Metrics collection
- **Grafana**: Metrics visualization
- **NGINX**: Reverse proxy and load balancer

### Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                        │
│                     (NGINX)                            │
└─────────────────┬───────────────────────────────────────┘
                  │
         ┌────────┴────────┐
         │                 │
    ┌────▼────┐       ┌────▼────┐
    │   Web   │       │   API   │
    │ (React) │       │(Node.js)│
    └─────────┘       └────┬────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
         │PostgreSQL│  │  Redis  │  │ Worker  │
         │(Database)│  │ (Cache) │  │(Jobs)   │
         └─────────┘  └─────────┘  └─────────┘
```

## CI/CD Pipeline

### GitHub Actions Workflows

#### CI Pipeline (`.github/workflows/ci.yml`)
- **Triggers**: Pull requests, pushes to main/develop
- **Jobs**:
  - Lint & format check
  - Type checking
  - Unit & integration tests
  - Security scanning
  - Build verification

#### Docker Build (`.github/workflows/docker.yml`)
- **Triggers**: Pushes to main/develop, tags
- **Jobs**:
  - Multi-service Docker builds
  - Security scanning
  - Image publishing to GHCR
  - Automated deployments

#### Release (`.github/workflows/release.yml`)
- **Triggers**: Version tags (v*.*.*)
- **Jobs**:
  - Full test suite
  - Release artifact creation
  - GitHub release creation
  - Production deployment triggers

### Pipeline Flow

```mermaid
graph TD
    A[Code Commit] --> B[CI Pipeline]
    B --> C{Tests Pass?}
    C -->|No| D[Fail Build]
    C -->|Yes| E[Build Docker Images]
    E --> F[Security Scan]
    F --> G{Branch?}
    G -->|develop| H[Deploy to Staging]
    G -->|main| I[Deploy to Production]
    G -->|feature| J[End]
    H --> K[Run Integration Tests]
    I --> L[Create Release]
```

## Docker Configuration

### Production Services

```yaml
# docker-compose.yml
services:
  postgres:    # Database with health checks
  redis:       # Cache with persistence
  prometheus:  # Metrics collection
  grafana:     # Visualization
```

### Development Overrides

```yaml
# docker-compose.dev.yml
services:
  api:         # Hot reload, debugging
  web:         # Development server
  worker:      # Development worker
  proxy:       # NGINX reverse proxy
```

### Container Features

- **Health Checks**: All services include comprehensive health checks
- **Resource Limits**: Memory and CPU limits configured
- **Security**: Non-root users, minimal base images
- **Logging**: Structured JSON logging
- **Networking**: Isolated bridge network
- **Volumes**: Persistent data and development mounts

## Scripts & Automation

### Deployment Scripts

- **`scripts/deploy.sh`**: Main deployment orchestrator
- **`scripts/migrate.sh`**: Database migration automation
- **`scripts/seed-data.sh`**: Development data seeding
- **`scripts/health-check.sh`**: Service health monitoring

### Database Scripts

- **`scripts/db/init/`**: Database initialization SQL
- **`scripts/seed/`**: Seed data generators

### Usage Examples

```bash
# Full development deployment
./scripts/deploy.sh --environment development --seed-data --monitoring

# Production deployment with specific tag
./scripts/deploy.sh --environment production --tag v1.2.3

# Database migrations only
./scripts/migrate.sh

# Health check all services
./scripts/health-check.sh comprehensive

# Seed test data
./scripts/seed-data.sh test
```

## Monitoring & Observability

### Metrics Collection

- **Prometheus**: Application and infrastructure metrics
- **Grafana**: Dashboard and alerting
- **Custom Metrics**: Business logic metrics

### Dashboards

- **FlakeGuard Overview**: Key performance indicators
- **Infrastructure**: System resource monitoring
- **Business Metrics**: Application-specific metrics

### Health Checks

- **Service Health**: HTTP endpoints for all services
- **Database Health**: Connection and query performance
- **Cache Health**: Redis connectivity and performance

### Logging

- **Structured Logging**: JSON format for all services
- **Log Aggregation**: Centralized logging (ready for ELK stack)
- **Error Tracking**: Comprehensive error reporting

## Security

### Container Security

- **Non-root Users**: All containers run as non-root
- **Minimal Images**: Alpine-based images
- **Security Scanning**: Trivy vulnerability scanning
- **Secrets Management**: Environment-based secrets

### Network Security

- **Isolated Networks**: Services communicate via Docker networks
- **Rate Limiting**: NGINX-based rate limiting
- **HTTPS Ready**: TLS configuration templates

### Access Control

- **Environment Separation**: Clear environment boundaries
- **Service Authentication**: API keys and JWT tokens
- **Database Security**: Connection pooling and access controls

## Environments

### Development
- **Purpose**: Local development and testing
- **Features**: Hot reload, debugging, development tools
- **Data**: Seeded development data
- **Monitoring**: Optional monitoring stack

### Staging
- **Purpose**: Pre-production testing
- **Features**: Production-like configuration
- **Data**: Sanitized production data or realistic test data
- **Monitoring**: Full monitoring stack

### Production
- **Purpose**: Live application serving users
- **Features**: High availability, backups, monitoring
- **Data**: Live user data with backups
- **Monitoring**: Full observability stack with alerting

## Configuration Management

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379

# Application
NODE_ENV=production
API_KEY=secure-api-key
JWT_SECRET=jwt-signing-secret

# Monitoring
PROMETHEUS_URL=http://prometheus:9090
GRAFANA_URL=http://grafana:3000
```

### Configuration Files

- **`config/redis.conf`**: Redis optimization
- **`config/prometheus.yml`**: Metrics scraping
- **`config/grafana/`**: Dashboard provisioning
- **`config/nginx/`**: Reverse proxy configuration

## Backup & Recovery

### Automated Backups

- **Database Backups**: Automated PostgreSQL dumps
- **Retention Policy**: 30 days for production, 7 days for staging
- **Verification**: Backup integrity checks

### Recovery Procedures

```bash
# List available backups
ls -la backups/

# Restore from backup
docker-compose exec postgres pg_restore -U postgres -d flakeguard backup.sql

# Rollback deployment
./scripts/deploy.sh --rollback
```

## Performance Optimization

### Database

- **Connection Pooling**: Optimized connection management
- **Query Optimization**: Indexed queries and performance monitoring
- **Caching**: Redis-based application caching

### Application

- **Resource Limits**: Configured memory and CPU limits
- **Horizontal Scaling**: Docker Compose scaling support
- **Load Balancing**: NGINX upstream configuration

### Monitoring

- **Performance Metrics**: Response time, throughput, error rates
- **Resource Monitoring**: CPU, memory, disk, network usage
- **Alerting**: Proactive issue notification

## Troubleshooting

### Common Issues

1. **Service Won't Start**
   ```bash
   docker-compose logs [service]
   ./scripts/health-check.sh [service]
   ```

2. **Database Connection Issues**
   ```bash
   ./scripts/health-check.sh postgres
   docker-compose exec postgres pg_isready
   ```

3. **Performance Issues**
   - Check Grafana dashboards
   - Review application logs
   - Monitor resource usage

### Debug Commands

```bash
# Service status
docker-compose ps

# Service logs
docker-compose logs -f [service]

# Connect to service
docker-compose exec [service] bash

# Database shell
docker-compose exec postgres psql -U postgres flakeguard

# Redis CLI
docker-compose exec redis redis-cli
```

## Development Workflow

### Local Development

1. **Start Infrastructure**
   ```bash
   docker-compose up -d postgres redis
   ```

2. **Run Migrations**
   ```bash
   ./scripts/migrate.sh
   ```

3. **Start Applications**
   ```bash
   # Option 1: Docker development
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d
   
   # Option 2: Local development
   pnpm dev
   ```

### Testing

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# E2E tests
pnpm test:e2e

# All tests with coverage
pnpm test:coverage
```

### Code Quality

```bash
# Linting
pnpm lint

# Type checking
pnpm typecheck

# Formatting
pnpm format

# All quality checks
pnpm quality
```

## Scaling

### Horizontal Scaling

```bash
# Scale API service
docker-compose up -d --scale api=3

# Scale worker service
docker-compose up -d --scale worker=2
```

### Load Balancing

- **NGINX**: Upstream load balancing configuration
- **Health Checks**: Automatic unhealthy instance removal
- **Session Affinity**: Sticky sessions if needed

### Database Scaling

- **Read Replicas**: PostgreSQL read replica configuration
- **Connection Pooling**: PgBouncer integration
- **Caching**: Redis caching layer

## Best Practices

### Development

- Use feature branches with descriptive names
- Write comprehensive tests for new features
- Follow conventional commit message format
- Update documentation with changes

### Deployment

- Test in staging before production deployment
- Use semantic versioning for releases
- Maintain deployment rollback capability
- Monitor deployments with health checks

### Security

- Regular security updates for base images
- Rotate secrets and API keys regularly
- Use least privilege access principles
- Monitor for security vulnerabilities

### Operations

- Monitor application and infrastructure metrics
- Implement comprehensive logging
- Maintain up-to-date documentation
- Practice disaster recovery procedures

## Support & Maintenance

### Regular Tasks

- **Weekly**: Review monitoring dashboards and logs
- **Monthly**: Update dependencies and security patches
- **Quarterly**: Disaster recovery testing
- **Annually**: Full security audit

### Monitoring

- **Uptime**: Service availability monitoring
- **Performance**: Response time and throughput tracking
- **Errors**: Error rate and pattern analysis
- **Resources**: Infrastructure utilization monitoring

### Documentation

Keep this documentation updated with:
- Infrastructure changes
- New deployment procedures
- Configuration updates
- Troubleshooting solutions

---

For additional support, refer to the project README or contact the development team.