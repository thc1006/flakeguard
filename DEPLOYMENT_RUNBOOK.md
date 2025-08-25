# FlakeGuard Production Deployment Runbook

**Version**: 1.0.0  
**Last Updated**: 2024-08-26  
**Owner**: DevOps Team  
**Environment**: Production

---

## 📋 Pre-Deployment Checklist

### 1. Infrastructure Prerequisites
- [ ] **Database server** (PostgreSQL 16) provisioned and accessible
- [ ] **Redis cluster** (Redis 7) configured and running
- [ ] **Container registry** credentials configured
- [ ] **Load balancer** configured with health checks
- [ ] **DNS records** pointing to load balancer
- [ ] **SSL certificates** installed and valid
- [ ] **Firewall rules** allowing necessary traffic
- [ ] **Backup storage** configured and accessible

### 2. Application Prerequisites
- [ ] **Environment variables** configured in deployment environment
- [ ] **Secrets** stored in secure secret management system
- [ ] **GitHub App** created with proper permissions
- [ ] **Slack App** configured (if enabled)
- [ ] **Webhook endpoints** configured and secured
- [ ] **Monitoring infrastructure** deployed and configured
- [ ] **Log aggregation** system ready

### 3. Security Prerequisites
- [ ] **Security scan** passed in CI/CD pipeline
- [ ] **Vulnerability assessment** completed
- [ ] **Secrets rotation** completed for production
- [ ] **Access controls** configured
- [ ] **Audit logging** enabled
- [ ] **Network security** rules applied

---

## 🚀 Deployment Procedure

### Phase 1: Pre-Deployment Validation

```bash
# 1. Clone and prepare repository
git clone https://github.com/flakeguard/flakeguard.git
cd flakeguard
git checkout main

# 2. Set up environment
cp .env.example .env
# Edit .env with production values

# 3. Run pre-deployment validation
chmod +x scripts/pre-deployment-validation.sh
./scripts/pre-deployment-validation.sh
```

**⚠️ STOP**: Only proceed if all validations pass.

### Phase 2: Infrastructure Deployment

#### 2.1 Deploy Core Services

```bash
# Start PostgreSQL and Redis
docker compose -f docker-compose.prod.yml up -d postgres redis

# Wait for services to be ready
docker compose -f docker-compose.prod.yml ps
```

#### 2.2 Verify Infrastructure Health

```bash
# Test PostgreSQL connection
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U postgres

# Test Redis connection  
docker compose -f docker-compose.prod.yml exec redis redis-cli ping

# Check logs for errors
docker compose -f docker-compose.prod.yml logs postgres redis
```

### Phase 3: Database Setup

#### 3.1 Apply Database Migrations

```bash
# Generate Prisma client
pnpm --filter=@flakeguard/api generate

# Apply migrations
pnpm --filter=@flakeguard/api migrate:deploy

# Verify migration status
pnpm --filter=@flakeguard/api exec prisma migrate status
```

#### 3.2 Seed Initial Data

```bash
# Run database seeding
pnpm --filter=@flakeguard/api seed

# Verify data was created
pnpm --filter=@flakeguard/api exec prisma db execute --stdin <<< "
SELECT 
  (SELECT COUNT(*) FROM \"Organization\") as orgs,
  (SELECT COUNT(*) FROM \"User\") as users,
  (SELECT COUNT(*) FROM \"FGRepository\") as repos;
"
```

### Phase 4: Application Deployment

#### 4.1 Build Application Images

```bash
# Build all application images
docker compose -f docker-compose.prod.yml build

# Tag images for deployment
docker tag flakeguard-api:latest flakeguard-api:$(date +%Y%m%d-%H%M%S)
docker tag flakeguard-worker:latest flakeguard-worker:$(date +%Y%m%d-%H%M%S)
docker tag flakeguard-web:latest flakeguard-web:$(date +%Y%m%d-%H%M%S)
```

#### 4.2 Deploy Application Services

```bash
# Deploy applications
docker compose -f docker-compose.prod.yml up -d api worker web

# Verify deployment
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs api worker web
```

### Phase 5: Monitoring and Observability

#### 5.1 Deploy Monitoring Stack

```bash
# Deploy Prometheus and Grafana
docker compose -f docker-compose.monitoring.yml up -d

# Verify monitoring services
curl -f http://localhost:9090/-/healthy  # Prometheus
curl -f http://localhost:3001/api/health # Grafana
```

#### 5.2 Configure Alerting

```bash
# Apply alert rules (if configured)
# curl -X POST http://prometheus:9090/-/reload
```

### Phase 6: Post-Deployment Verification

```bash
# Run comprehensive verification
chmod +x scripts/post-deployment-verification.sh
./scripts/post-deployment-verification.sh
```

**⚠️ STOP**: Only declare deployment successful if all verifications pass.

---

## 🔧 Configuration Management

### Environment Variables (Production)

```bash
# Core Application
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Database  
DATABASE_URL=postgresql://[encrypted-credentials]@db-host:5432/flakeguard?schema=public&sslmode=require

# Redis
REDIS_URL=redis://[credentials]@redis-host:6379

# Security
JWT_SECRET=[secure-32-char-key]
API_KEY=[secure-16-char-key]

# GitHub Integration
GITHUB_APP_ID=[production-app-id]
GITHUB_PRIVATE_KEY_PATH=/run/secrets/github-private-key
GITHUB_WEBHOOK_SECRET=[secure-webhook-secret]

# Feature Flags
ENABLE_SLACK_APP=true
ENABLE_GITHUB_WEBHOOKS=true
ENABLE_QUARANTINE_ACTIONS=true

# Performance Tuning
WORKER_CONCURRENCY=10
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW_MS=60000
```

### Secret Management

```bash
# Create Docker secrets (production)
echo "$GITHUB_PRIVATE_KEY" | docker secret create github_private_key -
echo "$JWT_SECRET" | docker secret create jwt_secret -
echo "$DATABASE_PASSWORD" | docker secret create db_password -
```

---

## 📊 Health Checks and Monitoring

### Service Health Endpoints

| Service | Health Check URL | Expected Response |
|---------|------------------|-------------------|
| API | `http://api:3000/health` | `{"status":"ok","timestamp":"..."}` |
| Worker | `http://worker:3001/health` | `{"status":"ok","queues":[...]}` |
| Web | `http://web:3002/health` | `200 OK` |
| PostgreSQL | `pg_isready -h postgres -p 5432` | `postgres:5432 - accepting connections` |
| Redis | `redis-cli -h redis ping` | `PONG` |

### Key Metrics to Monitor

```yaml
Application Metrics:
  - API response time (p95 < 500ms)
  - Error rate (< 0.1%)
  - Database connection pool usage
  - Queue depth and processing time
  - GitHub API rate limit usage

Infrastructure Metrics:
  - CPU usage (< 80%)
  - Memory usage (< 90%)
  - Disk space (< 85%)
  - Network I/O
  - Container restart count

Business Metrics:
  - Test runs processed per hour
  - Flaky tests detected
  - Quarantine actions taken
  - GitHub webhook success rate
```

### Alert Thresholds

```yaml
Critical (PagerDuty):
  - API downtime > 1 minute
  - Database connection failures > 5/min
  - Redis unavailable > 30 seconds
  - Disk space > 95%
  - Memory usage > 95%

Warning (Email):
  - API response time > 1s for 5 minutes
  - Error rate > 0.5% for 10 minutes
  - Queue depth > 1000 jobs
  - CPU usage > 90% for 15 minutes
```

---

## 🔄 Rollback Procedures

### Quick Rollback (Application Only)

```bash
# 1. Stop current services
docker compose -f docker-compose.prod.yml down api worker web

# 2. Rollback to previous images
docker tag flakeguard-api:previous flakeguard-api:latest
docker tag flakeguard-worker:previous flakeguard-worker:latest  
docker tag flakeguard-web:previous flakeguard-web:latest

# 3. Restart services
docker compose -f docker-compose.prod.yml up -d api worker web

# 4. Verify rollback
./scripts/post-deployment-verification.sh
```

### Full Rollback (Including Database)

```bash
# 1. Stop all services
docker compose -f docker-compose.prod.yml down

# 2. Restore database from backup
./scripts/restore-database.sh --backup-file=/backups/$(date -d "1 day ago" +%Y%m%d)_flakeguard.sql

# 3. Rollback to previous application version
docker tag flakeguard-api:previous flakeguard-api:latest
docker tag flakeguard-worker:previous flakeguard-worker:latest

# 4. Restart all services
docker compose -f docker-compose.prod.yml up -d

# 5. Verify complete system
./scripts/post-deployment-verification.sh --full
```

### Emergency Procedures

#### Circuit Breaker Activation
```bash
# Disable problematic features via environment variables
docker compose -f docker-compose.prod.yml exec api \
  sh -c 'echo "ENABLE_GITHUB_WEBHOOKS=false" >> /app/.env.override'

# Restart API to pick up changes
docker compose -f docker-compose.prod.yml restart api
```

#### Traffic Rerouting
```bash
# Route traffic to backup infrastructure (manual DNS/load balancer update)
# This requires access to your DNS provider or load balancer configuration
```

---

## 🔧 Troubleshooting Guide

### Common Issues and Solutions

#### 1. Database Connection Failures
```bash
# Check PostgreSQL status
docker compose -f docker-compose.prod.yml logs postgres
docker compose -f docker-compose.prod.yml exec postgres pg_isready

# Verify connection string
docker compose -f docker-compose.prod.yml exec api env | grep DATABASE_URL

# Test manual connection
docker compose -f docker-compose.prod.yml exec api \
  pnpm exec prisma db execute --stdin <<< "SELECT 1;"
```

#### 2. Migration Failures
```bash
# Check migration status
pnpm --filter=@flakeguard/api exec prisma migrate status

# Manual migration rollback if needed
pnpm --filter=@flakeguard/api exec prisma migrate resolve --rolled-back <migration-name>

# Force migration reset (dangerous - data loss)
# pnpm --filter=@flakeguard/api exec prisma migrate reset --force
```

#### 3. Worker Queue Issues
```bash
# Check Redis connection
docker compose -f docker-compose.prod.yml exec redis redis-cli ping

# Monitor queue status
docker compose -f docker-compose.prod.yml exec redis redis-cli info

# Clear stuck jobs (if necessary)
docker compose -f docker-compose.prod.yml exec redis redis-cli FLUSHDB
```

#### 4. High Memory Usage
```bash
# Check container memory usage
docker stats

# Restart memory-heavy services
docker compose -f docker-compose.prod.yml restart worker

# Scale services if needed
docker compose -f docker-compose.prod.yml up -d --scale worker=3
```

---

## 📝 Maintenance Procedures

### Daily Operations
- [ ] **Monitor dashboards** for any anomalies
- [ ] **Check alert status** and resolve any issues
- [ ] **Verify backup completion** and integrity
- [ ] **Review application logs** for errors or warnings

### Weekly Operations
- [ ] **Update dependencies** and security patches
- [ ] **Review performance metrics** and optimize if needed
- [ ] **Test backup restoration** procedures
- [ ] **Update documentation** based on operational learnings

### Monthly Operations  
- [ ] **Security audit** and vulnerability assessment
- [ ] **Capacity planning** review and scaling decisions
- [ ] **Disaster recovery testing** 
- [ ] **Update runbooks** and procedures
- [ ] **Review and rotate secrets** as needed

### Quarterly Operations
- [ ] **Major version updates** planning and execution
- [ ] **Infrastructure optimization** review
- [ ] **Business continuity planning** updates
- [ ] **Team training** on new procedures

---

## 📞 Escalation and Support

### On-Call Rotation
| Role | Primary | Secondary |
|------|---------|-----------|
| **DevOps Engineer** | @devops-primary | @devops-secondary |
| **Backend Developer** | @backend-lead | @backend-developer |
| **SRE** | @sre-lead | @sre-engineer |

### Emergency Contacts
- **Critical Issues**: Use PagerDuty integration
- **Non-Critical Issues**: Create GitHub issue or Slack #flakeguard-ops
- **Security Issues**: Contact security team immediately

### External Dependencies
- **Database Provider**: [Contact info and SLA]
- **Cloud Provider**: [Support contact and escalation path]
- **CDN Provider**: [Support contact for performance issues]
- **Monitoring Service**: [Support contact for dashboard issues]

---

## 📚 Related Documentation

- [FlakeGuard Architecture Overview](./docs/architecture.md)
- [API Documentation](./docs/api.md)
- [Database Schema Documentation](./docs/database.md)
- [Security Configuration Guide](./SECURITY_CONFIGURATION.md)
- [Monitoring and Alerting Guide](./docs/monitoring.md)
- [Incident Response Procedures](./docs/incident-response.md)

---

## 📜 Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2024-08-26 | 1.0.0 | Initial production deployment runbook | Claude Code |

---

**Note**: This runbook should be updated after each deployment to reflect any changes in procedures or lessons learned.