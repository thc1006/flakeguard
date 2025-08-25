# FlakeGuard Security Configuration Guide

This document provides comprehensive guidance on configuring security features for FlakeGuard in production environments.

## Table of Contents

1. [Environment Variables Reference](#environment-variables-reference)
2. [Secret Management](#secret-management)
3. [Webhook Security](#webhook-security)
4. [API Security](#api-security)
5. [Security Headers & CSP](#security-headers--csp)
6. [Rate Limiting](#rate-limiting)
7. [Security Monitoring](#security-monitoring)
8. [Production Deployment](#production-deployment)

## Environment Variables Reference

### Core Security Variables

| Variable | Required | Default | Rotation Schedule | Description |
|----------|----------|---------|-------------------|-------------|
| `JWT_SECRET` | ✅ | - | 90 days | 32+ character secret for JWT token signing |
| `API_KEY` | ✅ | - | 60 days | 16+ character key for API authentication |
| `GITHUB_WEBHOOK_SECRET` | ✅ | - | 180 days | Secret for verifying GitHub webhook signatures |
| `SLACK_SIGNING_SECRET` | ❌ | - | 180 days | Secret for verifying Slack webhook signatures |
| `SLACK_BOT_TOKEN` | ❌ | - | 365 days | Slack bot token (rotated by Slack) |

### GitHub App Configuration

| Variable | Required | Default | Rotation Schedule | Description |
|----------|----------|---------|-------------------|-------------|
| `GITHUB_APP_ID` | ✅ | - | Never | GitHub App ID (numeric) |
| `GITHUB_APP_PRIVATE_KEY` | ❌* | - | 365 days | GitHub App private key (PEM format) |
| `GITHUB_APP_PRIVATE_KEY_FILE` | ❌* | - | 365 days | Path to GitHub App private key file |
| `GITHUB_CLIENT_ID` | ✅ | - | 365 days | GitHub App client ID |
| `GITHUB_CLIENT_SECRET` | ✅ | - | 365 days | GitHub App client secret |

*Either `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_FILE` must be provided.

### Security Feature Toggles

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENABLE_CSRF_PROTECTION` | ❌ | `true` (prod) | Enable CSRF protection for dashboard |
| `ENABLE_AUDIT_LOGGING` | ❌ | `true` | Enable security audit logging |
| `ENABLE_RATE_LIMITING` | ❌ | `true` | Enable request rate limiting |
| `WEBHOOK_SIGNATURE_REQUIRED` | ❌ | `true` | Require webhook signature verification |

### Rate Limiting Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_GLOBAL_MAX` | ❌ | `1000` | Global requests per minute |
| `RATE_LIMIT_API_MAX` | ❌ | `100` | API requests per minute per user |
| `RATE_LIMIT_WEBHOOK_MAX` | ❌ | `50` | Webhook requests per minute per IP |
| `RATE_LIMIT_WINDOW_MS` | ❌ | `60000` | Rate limiting window in milliseconds |

## Secret Management

### Loading Priority

FlakeGuard loads secrets in the following priority order:

1. **File-based secrets**: Environment variables ending with `_FILE`
2. **Docker secrets**: Files in `/run/secrets/`
3. **Environment variables**: Direct values

### File-based Secret Loading

```bash
# Use file paths for secrets
GITHUB_APP_PRIVATE_KEY_FILE=/etc/secrets/github-app-key.pem
JWT_SECRET_FILE=/etc/secrets/jwt-secret.txt
API_KEY_FILE=/etc/secrets/api-key.txt
```

### Docker Secrets Integration

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    image: flakeguard/api
    secrets:
      - github_app_private_key
      - jwt_secret
      - api_key
      - github_webhook_secret
    environment:
      - GITHUB_APP_ID=123456
      - GITHUB_CLIENT_ID=Iv1.abcdef123456

secrets:
  github_app_private_key:
    file: ./secrets/github-app-key.pem
  jwt_secret:
    file: ./secrets/jwt-secret.txt
  api_key:
    file: ./secrets/api-key.txt
  github_webhook_secret:
    file: ./secrets/webhook-secret.txt
```

### Kubernetes Secrets

```yaml
# kubernetes/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: flakeguard-secrets
type: Opaque
data:
  github-app-private-key: <base64-encoded-pem-key>
  jwt-secret: <base64-encoded-secret>
  api-key: <base64-encoded-key>
  github-webhook-secret: <base64-encoded-secret>

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flakeguard-api
spec:
  template:
    spec:
      containers:
      - name: api
        image: flakeguard/api
        env:
        - name: GITHUB_APP_PRIVATE_KEY_FILE
          value: "/etc/secrets/github-app-private-key"
        - name: JWT_SECRET_FILE
          value: "/etc/secrets/jwt-secret"
        volumeMounts:
        - name: secrets
          mountPath: /etc/secrets
          readOnly: true
      volumes:
      - name: secrets
        secret:
          secretName: flakeguard-secrets
          items:
          - key: github-app-private-key
            path: github-app-private-key
          - key: jwt-secret
            path: jwt-secret
```

## Webhook Security

### GitHub Webhook Verification

FlakeGuard verifies GitHub webhooks using HMAC-SHA256 signatures:

```typescript
// Automatic verification in webhook handlers
app.post('/api/github/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'];
  const verified = request.verifyWebhookSignature({
    payload: request.body,
    signature,
    provider: 'github'
  });
  
  if (!verified) {
    return reply.status(401).send({ error: 'Invalid signature' });
  }
  
  // Process webhook...
});
```

### Slack Webhook Verification

Slack webhooks are verified using request signatures and timestamps to prevent replay attacks:

```typescript
app.post('/api/slack/webhook', async (request, reply) => {
  const signature = request.headers['x-slack-signature'];
  const timestamp = request.headers['x-slack-request-timestamp'];
  
  const verified = request.verifyWebhookSignature({
    payload: request.body,
    signature,
    timestamp,
    provider: 'slack'
  });
  
  if (!verified) {
    return reply.status(401).send({ error: 'Invalid signature or timestamp' });
  }
  
  // Process webhook...
});
```

### Replay Attack Prevention

- GitHub: Webhooks include unique delivery IDs
- Slack: Requests older than 5 minutes are rejected
- All webhooks are logged for audit trails

## API Security

### Authentication

```typescript
// JWT token authentication
headers: {
  'Authorization': 'Bearer <jwt-token>',
  'Content-Type': 'application/json'
}

// API key authentication  
headers: {
  'X-API-Key': '<api-key>',
  'Content-Type': 'application/json'
}
```

### Input Validation

All API endpoints use Zod schemas for input validation:

```typescript
const createTestRunSchema = z.object({
  repositoryId: z.string().min(1),
  runId: z.string().min(1),
  testResults: z.array(testResultSchema),
});

app.post('/api/ingestion/junit', {
  schema: {
    body: createTestRunSchema,
  },
}, handler);
```

### CORS Configuration

```typescript
// Production CORS settings
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') || false,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'X-API-Key',
    'X-CSRF-Token',
    'X-Session-ID'
  ],
});
```

## Security Headers & CSP

### Default Security Headers

FlakeGuard automatically adds security headers to all responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY  
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self';
font-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

### Custom CSP Configuration

```typescript
// Custom CSP in security plugin
const customCSP = {
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.example.com'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
  },
};

app.register(securityPlugin, {
  config: { csp: customCSP },
});
```

## Rate Limiting

### Default Rate Limits

- **Global**: 1000 requests/minute per IP
- **API**: 100 requests/minute per authenticated user
- **Webhooks**: 50 requests/minute per installation

### Custom Rate Limit Configuration

```typescript
app.register(securityPlugin, {
  config: {
    rateLimiting: {
      global: { max: 2000, window: 60000 },
      api: { max: 200, window: 60000 },
      webhook: { max: 100, window: 60000 },
    },
  },
});
```

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
Retry-After: 60
```

## Security Monitoring

### Audit Events

FlakeGuard logs security events for monitoring:

```typescript
interface SecurityAuditEvent {
  type: 'webhook_verification' | 'rate_limit' | 'csrf_violation' | 'authentication_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string; // IP address
  details: Record<string, any>;
  timestamp: Date;
  userAgent?: string;
}
```

### Audit Endpoints

```bash
# Get recent security events
GET /api/security/audit-events?limit=100&severity=high

# Get events by type
GET /api/security/audit-events?type=webhook_verification
```

### Metrics Integration

Security metrics are exposed for Prometheus:

```
# HELP flakeguard_security_events_total Total number of security events
# TYPE flakeguard_security_events_total counter
flakeguard_security_events_total{type="rate_limit",severity="medium"} 42

# HELP flakeguard_webhook_verifications_total Total webhook verifications
# TYPE flakeguard_webhook_verifications_total counter
flakeguard_webhook_verifications_total{provider="github",status="success"} 1523
```

## Production Deployment

### Docker Production Setup

```dockerfile
# Dockerfile
FROM node:20-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S flakeguard -u 1001

# Copy application
COPY --chown=flakeguard:nodejs . /app
WORKDIR /app

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Switch to non-root user
USER flakeguard

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Security Hardening Checklist

- [ ] All secrets loaded from secure storage (not environment variables)
- [ ] HTTPS enabled with valid TLS certificate
- [ ] Rate limiting configured for your traffic patterns
- [ ] CORS origins restricted to trusted domains
- [ ] Security headers and CSP configured
- [ ] Webhook signature verification enabled
- [ ] Audit logging enabled and monitored
- [ ] Database connections use TLS
- [ ] Container runs as non-root user
- [ ] Network policies restrict access
- [ ] Regular security updates applied

### Environment-specific Security

```bash
# Development
NODE_ENV=development
ENABLE_CSRF_PROTECTION=false
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
WEBHOOK_SIGNATURE_REQUIRED=false

# Staging
NODE_ENV=staging
ENABLE_CSRF_PROTECTION=true
CORS_ORIGIN=https://staging.flakeguard.dev
WEBHOOK_SIGNATURE_REQUIRED=true

# Production
NODE_ENV=production
ENABLE_CSRF_PROTECTION=true
CORS_ORIGIN=https://flakeguard.dev,https://app.flakeguard.dev
WEBHOOK_SIGNATURE_REQUIRED=true
ENABLE_AUDIT_LOGGING=true
```

### Secret Rotation Schedule

| Secret Type | Rotation Frequency | Auto-Rotation | Notes |
|-------------|-------------------|---------------|-------|
| JWT Secret | 90 days | ❌ | Invalidates all existing tokens |
| API Keys | 60 days | ❌ | Can be rotated incrementally |
| Webhook Secrets | 180 days | ❌ | Must update GitHub/Slack config |
| GitHub App Key | 365 days | ❌ | Generate new key in GitHub |
| Database Passwords | 30 days | ✅ | Use managed database rotation |
| TLS Certificates | 90 days | ✅ | Use cert-manager or similar |

### Monitoring & Alerting

```yaml
# Prometheus alerts
groups:
- name: flakeguard-security
  rules:
  - alert: HighFailedWebhookVerifications
    expr: rate(flakeguard_webhook_verifications_total{status="failed"}[5m]) > 0.1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: High rate of failed webhook verifications
      
  - alert: RateLimitExceeded
    expr: rate(flakeguard_security_events_total{type="rate_limit"}[5m]) > 1
    for: 1m
    labels:
      severity: warning
    annotations:
      summary: Multiple clients hitting rate limits
```

## Security Contact

For security issues, please follow our [Security Policy](SECURITY.md):

- **Security Email**: security@flakeguard.dev
- **PGP Key**: [Available in SECURITY.md](SECURITY.md#pgp-key)
- **Response Time**: 24-48 hours for critical issues

## References

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [GitHub Webhook Security](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)
- [Slack Request Verification](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Content Security Policy Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)