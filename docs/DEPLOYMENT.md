# FlakeGuard Deployment Guide

## Quick Start

Get FlakeGuard running in production with our comprehensive deployment guide.

### Prerequisites

- **Docker** 24.0+ with Compose v2
- **Kubernetes** 1.28+ (for production)
- **Node.js** 20+ (for development)
- **PostgreSQL** 16+ 
- **Redis** 7+

### 🚀 Production Deployment (5 minutes)

```bash
# 1. Clone repository
git clone https://github.com/flakeguard/flakeguard.git
cd flakeguard

# 2. Configure environment
cp .env.example .env.production
# Edit .env.production with your settings

# 3. Create Docker secrets
./scripts/create-secrets.sh

# 4. Deploy with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# 5. Initialize database
docker-compose -f docker-compose.prod.yml exec api pnpm migrate:deploy
docker-compose -f docker-compose.prod.yml exec api pnpm seed

# 6. Verify deployment
curl https://your-domain.com/health
```

## Deployment Options

### 1. Docker Compose (Recommended for small-medium deployments)

**Pros**: Simple setup, integrated monitoring, easy maintenance
**Best for**: Single server, staging environments, small teams

```bash
# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# Development
docker-compose -f docker-compose.dev.yml up -d

# With monitoring
docker-compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

### 2. Kubernetes (Enterprise deployments)

**Pros**: High availability, auto-scaling, enterprise features
**Best for**: Large-scale deployments, multi-region, enterprise environments

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets/
kubectl apply -f k8s/configmaps/
kubectl apply -f k8s/production/

# Verify deployment
kubectl get pods -n flakeguard
kubectl get services -n flakeguard
```

### 3. Cloud Platforms

#### AWS ECS
```bash
# Deploy using AWS CLI
aws ecs create-cluster --cluster-name flakeguard
./scripts/deploy-ecs.sh
```

#### Google Cloud Run
```bash
# Deploy to Cloud Run
gcloud run deploy flakeguard-api \
  --image ghcr.io/flakeguard/flakeguard-api:latest \
  --platform managed
```

#### Azure Container Instances
```bash
# Deploy to Azure
az container create \
  --resource-group flakeguard \
  --name flakeguard-api \
  --image ghcr.io/flakeguard/flakeguard-api:latest
```

## Configuration

### Environment Variables

#### Core Configuration
```env
# Application
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
VERSION=latest

# Database
DATABASE_URL=postgresql://user:pass@host:5432/flakeguard
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://host:6379
REDIS_PASSWORD=secure_password

# Security
JWT_SECRET=your-super-secure-jwt-secret-minimum-32-chars
API_KEY=your-api-key-minimum-16-chars
WEBHOOK_SECRET=your-webhook-secret
```

#### GitHub Integration
```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="FAKE_PRIVATE_KEY_FOR_TESTS"
GITHUB_WEBHOOK_SECRET=your-github-webhook-secret
```

#### Slack Integration (Optional)
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
```

### Production Security Settings

```env
# HTTPS and Security
HTTPS_ENABLED=true
SSL_CERT_PATH=/etc/ssl/certs/flakeguard.crt
SSL_KEY_PATH=/etc/ssl/private/flakeguard.key

# CORS Configuration
CORS_ORIGIN=https://your-domain.com
CORS_CREDENTIALS=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=1000

# Session Security
SESSION_SECRET=your-session-secret-minimum-32-chars
SECURE_COOKIES=true
SAME_SITE_COOKIES=strict
```

## Infrastructure Requirements

### Minimum Requirements

| Component | CPU | Memory | Storage | Network |
|-----------|-----|---------|---------|---------|
| API Server | 0.5 cores | 512MB | 1GB | 100Mbps |
| Web Dashboard | 0.25 cores | 256MB | 512MB | 50Mbps |
| Worker | 0.5 cores | 512MB | 2GB | 100Mbps |
| PostgreSQL | 1 core | 1GB | 20GB | 100Mbps |
| Redis | 0.25 cores | 256MB | 1GB | 50Mbps |

### Recommended Production Setup

| Component | CPU | Memory | Storage | Replicas |
|-----------|-----|---------|---------|----------|
| API Server | 1 core | 1GB | 2GB | 2-3 |
| Web Dashboard | 0.5 cores | 512MB | 1GB | 2 |
| Worker | 1 core | 1GB | 5GB | 3-5 |
| PostgreSQL | 2 cores | 4GB | 100GB | 1 (HA) |
| Redis | 1 core | 1GB | 10GB | 1 (HA) |

### High Availability Setup

```yaml
# Load Balancer Configuration
nginx:
  replicas: 2
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

# API Server with Auto-scaling
api:
  replicas: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPU: 70
    targetMemory: 80
```

## Database Setup

### PostgreSQL Configuration

#### Installation
```bash
# Using Docker
docker run -d \
  --name flakeguard-postgres \
  -e POSTGRES_DB=flakeguard \
  -e POSTGRES_USER=flakeguard \
  -e POSTGRES_PASSWORD=secure_password \
  -p 5432:5432 \
  postgres:16-alpine

# Using package manager (Ubuntu)
sudo apt update
sudo apt install postgresql-16 postgresql-contrib
```

#### Database Initialization
```bash
# Create database and user
sudo -u postgres psql -c "CREATE DATABASE flakeguard;"
sudo -u postgres psql -c "CREATE USER flakeguard WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE flakeguard TO flakeguard;"

# Run migrations
pnpm --filter=@flakeguard/api migrate:deploy

# Seed initial data
pnpm --filter=@flakeguard/api seed
```

#### Performance Tuning
```sql
-- PostgreSQL configuration for production
-- Add to postgresql.conf

# Memory settings
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# Connection settings
max_connections = 200
shared_preload_libraries = 'pg_stat_statements'

# Logging
log_statement = 'mod'
log_duration = on
log_min_duration_statement = 1000

# Performance
random_page_cost = 1.1
effective_io_concurrency = 200
```

### Redis Configuration

#### Installation
```bash
# Using Docker
docker run -d \
  --name flakeguard-redis \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --requirepass secure_password

# Using package manager
sudo apt install redis-server
```

#### Redis Configuration
```conf
# redis.conf for production

# Memory management
maxmemory 512mb
maxmemory-policy allkeys-lru

# Persistence
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# Security
requirepass secure_password
bind 127.0.0.1

# Performance
tcp-keepalive 60
timeout 300
```

## Monitoring & Logging

### Prometheus Configuration
```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'flakeguard-api'
    static_configs:
      - targets: ['api:3000']
    metrics_path: '/metrics'
    scrape_interval: 30s

  - job_name: 'flakeguard-worker'
    static_configs:
      - targets: ['worker:9090']
    metrics_path: '/metrics'
```

### Grafana Dashboards

Pre-configured dashboards available:
- **Application Performance**: Response times, throughput, errors
- **Infrastructure**: CPU, memory, disk, network usage
- **Business Metrics**: Test processing, failure detection rates
- **Security**: Vulnerability scans, failed authentications

### Logging Configuration

```yaml
# Logging configuration
logging:
  level: info
  format: json
  outputs:
    - console
    - file: /var/log/flakeguard/app.log
  
  # Structured logging
  fields:
    service: flakeguard-api
    version: ${VERSION}
    environment: ${NODE_ENV}
```

## SSL/TLS Configuration

### Let's Encrypt (Recommended)
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Generate certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### Custom Certificate
```bash
# Generate self-signed certificate (development)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Production certificate setup
sudo cp your-domain.crt /etc/ssl/certs/
sudo cp your-domain.key /etc/ssl/private/
sudo chmod 600 /etc/ssl/private/your-domain.key
```

### Nginx SSL Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/ssl/certs/your-domain.crt;
    ssl_certificate_key /etc/ssl/private/your-domain.key;
    ssl_session_cache shared:le_nginx_SSL:10m;
    ssl_session_timeout 1440m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    location / {
        proxy_pass http://web:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://api:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Backup & Recovery

### Database Backup
```bash
# Automated backup script
#!/bin/bash
BACKUP_DIR="/backups/postgres"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="flakeguard_backup_${DATE}.sql"

# Create backup
pg_dump -h localhost -U flakeguard flakeguard > "${BACKUP_DIR}/${BACKUP_FILE}"

# Compress backup
gzip "${BACKUP_DIR}/${BACKUP_FILE}"

# Cleanup old backups (keep last 7 days)
find "${BACKUP_DIR}" -name "*.gz" -mtime +7 -delete
```

### Redis Backup
```bash
# Redis backup script
#!/bin/bash
BACKUP_DIR="/backups/redis"
DATE=$(date +"%Y%m%d_%H%M%S")

# Create Redis backup
redis-cli --rdb "${BACKUP_DIR}/dump_${DATE}.rdb"

# Cleanup old backups
find "${BACKUP_DIR}" -name "*.rdb" -mtime +3 -delete
```

### Recovery Procedures
```bash
# Database recovery
gunzip -c backup_file.sql.gz | psql -h localhost -U flakeguard flakeguard

# Redis recovery
redis-cli FLUSHALL
redis-cli --rdb dump.rdb
sudo systemctl restart redis
```

## Performance Optimization

### Application Performance
```env
# Node.js optimization
NODE_OPTIONS="--max-old-space-size=2048 --optimize-for-size"
UV_THREADPOOL_SIZE=8

# Database connection pooling
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
DATABASE_IDLE_TIMEOUT=30000
DATABASE_CONNECTION_TIMEOUT=60000

# Redis optimization
REDIS_POOL_SIZE=10
REDIS_RETRY_ATTEMPTS=3
REDIS_RETRY_DELAY=1000
```

### Caching Strategy
```yaml
# Caching configuration
cache:
  # Application cache
  app:
    ttl: 300
    max_size: 1000

  # API response cache
  api:
    ttl: 60
    max_size: 500

  # Static asset cache
  static:
    ttl: 86400
    max_size: 10000
```

### Database Optimization
```sql
-- Index optimization
CREATE INDEX CONCURRENTLY idx_test_cases_repo_name 
ON test_cases(repository_id, test_name);

CREATE INDEX CONCURRENTLY idx_workflow_runs_created 
ON workflow_runs(created_at DESC);

-- Query optimization
ANALYZE;
REINDEX DATABASE flakeguard;
```

## Scaling Strategies

### Horizontal Scaling
```yaml
# Kubernetes HPA configuration
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: flakeguard-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: flakeguard-api
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Load Balancing
```nginx
# Nginx upstream configuration
upstream flakeguard_api {
    least_conn;
    server api-1:3000 max_fails=3 fail_timeout=30s;
    server api-2:3000 max_fails=3 fail_timeout=30s;
    server api-3:3000 max_fails=3 fail_timeout=30s;
    
    # Health check
    keepalive 32;
}

upstream flakeguard_web {
    least_conn;
    server web-1:3001 max_fails=3 fail_timeout=30s;
    server web-2:3001 max_fails=3 fail_timeout=30s;
    
    keepalive 32;
}
```

## Security Hardening

### Container Security
```dockerfile
# Security-hardened Dockerfile practices
FROM node:20-alpine AS runtime

# Create non-root user
RUN addgroup -g 1001 -S flakeguard && \
    adduser -S -D -H -u 1001 -s /sbin/nologin flakeguard -G flakeguard

# Set secure permissions
RUN chmod 755 /app && \
    chown -R flakeguard:flakeguard /app

USER flakeguard

# Security labels
LABEL security.scan="trivy" \
      security.hardened="true" \
      security.rootless="true"
```

### Network Security
```yaml
# Network policies (Kubernetes)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: flakeguard-network-policy
spec:
  podSelector:
    matchLabels:
      app: flakeguard
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: nginx
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
```

### Secret Management
```bash
# Using Docker Secrets
echo "secret-value" | docker secret create jwt_secret -

# Using Kubernetes Secrets
kubectl create secret generic flakeguard-secrets \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=api-key="$(openssl rand -base64 24)"

# Using HashiCorp Vault
vault kv put secret/flakeguard \
  jwt_secret="$(openssl rand -base64 32)" \
  api_key="$(openssl rand -base64 24)"
```

## Troubleshooting

### Common Issues

#### Application Won't Start
```bash
# Check logs
docker-compose logs api
kubectl logs -f deployment/flakeguard-api

# Check environment variables
docker-compose exec api env | grep -E "(DATABASE|REDIS|JWT)"

# Test database connection
docker-compose exec api node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$queryRaw\`SELECT 1\`.then(console.log).catch(console.error);
"
```

#### Database Connection Issues
```bash
# Test PostgreSQL connection
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "SELECT version();"

# Check connection limits
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "
SELECT count(*) as active_connections, 
       setting::int as max_connections
FROM pg_stat_activity, pg_settings 
WHERE name='max_connections';
"

# Reset connections
docker-compose restart postgres
```

#### Redis Connection Issues
```bash
# Test Redis connection
docker-compose exec redis redis-cli ping

# Check Redis info
docker-compose exec redis redis-cli info server

# Clear Redis cache
docker-compose exec redis redis-cli flushall
```

#### SSL Certificate Issues
```bash
# Check certificate expiry
openssl x509 -in /etc/ssl/certs/your-domain.crt -noout -dates

# Verify certificate chain
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Renew Let's Encrypt certificate
sudo certbot renew --force-renewal
```

### Performance Issues

#### High Memory Usage
```bash
# Monitor memory usage
docker stats
kubectl top pods

# Analyze Node.js heap
docker-compose exec api node --inspect=0.0.0.0:9229 dist/server.js

# Optimize database queries
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "
SELECT query, calls, mean_time, total_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;
"
```

#### High CPU Usage
```bash
# Profile application
docker-compose exec api node --prof dist/server.js

# Database query analysis
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "
SELECT query, calls, mean_time, stddev_time 
FROM pg_stat_statements 
WHERE mean_time > 1000 
ORDER BY mean_time DESC;
"
```

### Recovery Procedures

#### Complete System Recovery
```bash
# 1. Stop all services
docker-compose down

# 2. Restore database from backup
gunzip -c /backups/postgres/latest_backup.sql.gz | \
  docker-compose exec -T postgres psql -U flakeguard flakeguard

# 3. Restore Redis data
docker-compose exec redis redis-cli --rdb /backups/redis/latest_dump.rdb

# 4. Start services
docker-compose up -d

# 5. Verify functionality
curl https://your-domain.com/health
```

## Support & Maintenance

### Regular Maintenance Tasks

#### Daily
- Monitor system health and logs
- Check backup completion
- Review security alerts

#### Weekly  
- Update security patches
- Analyze performance metrics
- Clean up old logs and backups

#### Monthly
- Review and rotate secrets
- Update dependencies
- Capacity planning review

### Support Channels

- **Documentation**: [FlakeGuard Wiki](https://github.com/flakeguard/flakeguard/wiki)
- **Issues**: [GitHub Issues](https://github.com/flakeguard/flakeguard/issues)
- **Discussions**: [GitHub Discussions](https://github.com/flakeguard/flakeguard/discussions)
- **Security**: security@flakeguard.dev

---

For additional deployment scenarios and advanced configurations, consult our [Advanced Deployment Guide](./DEPLOYMENT-ADVANCED.md).