# FlakeGuard 安全配置指南

本文檔提供了在生產環境中配置 FlakeGuard 安全功能的綜合指導。

## 目錄

1. [環境變數參考](#環境變數參考)
2. [秘密管理](#秘密管理)
3. [Webhook 安全](#webhook-安全)
4. [API 安全](#api-安全)
5. [安全標頭與 CSP](#安全標頭與-csp)
6. [流量限制](#流量限制)
7. [安全監控](#安全監控)
8. [生產部署](#生產部署)

## 環境變數參考

### 核心安全變數

| 變數 | 必需 | 預設值 | 輪換週期 | 描述 |
|------|------|--------|----------|------|
| `JWT_SECRET` | ✅ | - | 90 天 | JWT 令牌簽署用的 32+ 字符秘密 |
| `API_KEY` | ✅ | - | 60 天 | API 身份驗證用的 16+ 字符金鑰 |
| `GITHUB_WEBHOOK_SECRET` | ✅ | - | 180 天 | 驗證 GitHub webhook 簽章的秘密 |
| `SLACK_SIGNING_SECRET` | ❌ | - | 180 天 | 驗證 Slack webhook 簽章的秘密 |
| `SLACK_BOT_TOKEN` | ❌ | - | 365 天 | Slack 機器人令牌（由 Slack 輪換） |

### GitHub 應用程式配置

| 變數 | 必需 | 預設值 | 輪換週期 | 描述 |
|------|------|--------|----------|------|
| `GITHUB_APP_ID` | ✅ | - | 永不 | GitHub 應用程式 ID（數字） |
| `GITHUB_APP_PRIVATE_KEY` | ❌* | - | 365 天 | GitHub 應用程式私鑰（PEM 格式） |
| `GITHUB_APP_PRIVATE_KEY_FILE` | ❌* | - | 365 天 | GitHub 應用程式私鑰檔案路徑 |
| `GITHUB_CLIENT_ID` | ✅ | - | 365 天 | GitHub 應用程式客戶端 ID |
| `GITHUB_CLIENT_SECRET` | ✅ | - | 365 天 | GitHub 應用程式客戶端秘密 |

*必須提供 `GITHUB_APP_PRIVATE_KEY` 或 `GITHUB_APP_PRIVATE_KEY_FILE` 其中之一。

### 安全功能開關

| 變數 | 必需 | 預設值 | 描述 |
|------|------|--------|----- |
| `ENABLE_CSRF_PROTECTION` | ❌ | `true`（生產） | 啟用儀表板的 CSRF 保護 |
| `ENABLE_AUDIT_LOGGING` | ❌ | `true` | 啟用安全稽核日誌 |
| `ENABLE_RATE_LIMITING` | ❌ | `true` | 啟用請求流量限制 |
| `WEBHOOK_SIGNATURE_REQUIRED` | ❌ | `true` | 要求 webhook 簽章驗證 |

### 流量限制配置

| 變數 | 必需 | 預設值 | 描述 |
|------|------|--------|----- |
| `RATE_LIMIT_GLOBAL_MAX` | ❌ | `1000` | 全域每分鐘請求數 |
| `RATE_LIMIT_API_MAX` | ❌ | `100` | 每用戶每分鐘 API 請求數 |
| `RATE_LIMIT_WEBHOOK_MAX` | ❌ | `50` | 每 IP 每分鐘 webhook 請求數 |
| `RATE_LIMIT_WINDOW_MS` | ❌ | `60000` | 流量限制窗口（毫秒） |

## 秘密管理

### 載入優先級

FlakeGuard 按以下優先級順序載入秘密：

1. **基於檔案的秘密**：以 `_FILE` 結尾的環境變數
2. **Docker 秘密**：`/run/secrets/` 中的檔案
3. **環境變數**：直接值

### 基於檔案的秘密載入

```bash
# 使用檔案路徑儲存秘密
GITHUB_APP_PRIVATE_KEY_FILE=/etc/secrets/github-app-key.pem
JWT_SECRET_FILE=/etc/secrets/jwt-secret.txt
API_KEY_FILE=/etc/secrets/api-key.txt
```

### Docker 秘密整合

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

### Kubernetes 秘密

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
```

## Webhook 安全

### GitHub Webhook 驗證

FlakeGuard 使用 HMAC-SHA256 簽章驗證 GitHub webhook：

```typescript
// webhook 處理器中的自動驗證
app.post('/api/github/webhook', async (request, reply) => {
  const signature = request.headers['x-hub-signature-256'];
  const verified = request.verifyWebhookSignature({
    payload: request.body,
    signature,
    provider: 'github'
  });
  
  if (!verified) {
    return reply.status(401).send({ error: '無效簽章' });
  }
  
  // 處理 webhook...
});
```

### Slack Webhook 驗證

Slack webhook 使用請求簽章和時間戳驗證，以防止重放攻擊：

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
    return reply.status(401).send({ error: '無效簽章或時間戳' });
  }
  
  // 處理 webhook...
});
```

### 重放攻擊防護

- GitHub：Webhook 包含唯一的傳遞 ID
- Slack：拒絕超過 5 分鐘的請求
- 所有 webhook 都記錄稽核日誌

## API 安全

### 身份驗證

```typescript
// JWT 令牌身份驗證
headers: {
  'Authorization': 'Bearer <jwt-token>',
  'Content-Type': 'application/json'
}

// API 金鑰身份驗證  
headers: {
  'X-API-Key': '<api-key>',
  'Content-Type': 'application/json'
}
```

### 輸入驗證

所有 API 端點使用 Zod 模式進行輸入驗證：

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

### CORS 配置

```typescript
// 生產環境 CORS 設定
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

## 安全標頭與 CSP

### 預設安全標頭

FlakeGuard 自動為所有回應添加安全標頭：

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY  
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### 內容安全政策

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

## 流量限制

### 預設流量限制

- **全域**：每 IP 每分鐘 1000 請求
- **API**：每認證用戶每分鐘 100 請求
- **Webhook**：每安裝每分鐘 50 請求

### 自訂流量限制配置

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

## 安全監控

### 稽核事件

FlakeGuard 記錄安全事件以供監控：

```typescript
interface SecurityAuditEvent {
  type: 'webhook_verification' | 'rate_limit' | 'csrf_violation' | 'authentication_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string; // IP 地址
  details: Record<string, any>;
  timestamp: Date;
  userAgent?: string;
}
```

### 稽核端點

```bash
# 獲取近期安全事件
GET /api/security/audit-events?limit=100&severity=high

# 按類型獲取事件
GET /api/security/audit-events?type=webhook_verification
```

### 指標整合

安全指標暴露給 Prometheus：

```
# HELP flakeguard_security_events_total 安全事件總數
# TYPE flakeguard_security_events_total counter
flakeguard_security_events_total{type="rate_limit",severity="medium"} 42

# HELP flakeguard_webhook_verifications_total Webhook 驗證總數
# TYPE flakeguard_webhook_verifications_total counter
flakeguard_webhook_verifications_total{provider="github",status="success"} 1523
```

## 生產部署

### Docker 生產設置

```dockerfile
# Dockerfile
FROM node:20-alpine AS production

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs
RUN adduser -S flakeguard -u 1001

# 複製應用程式
COPY --chown=flakeguard:nodejs . /app
WORKDIR /app

# 安裝依賴項
RUN npm ci --only=production && npm cache clean --force

# 切換到非 root 用戶
USER flakeguard

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### 安全加固檢查清單

- [ ] 所有秘密從安全儲存載入（非環境變數）
- [ ] 啟用 HTTPS 且有效 TLS 憑證
- [ ] 流量限制已配置適合流量模式
- [ ] CORS 來源限制為可信網域
- [ ] 安全標頭和 CSP 已配置
- [ ] 已啟用 webhook 簽章驗證
- [ ] 已啟用並監控稽核日誌
- [ ] 資料庫連接使用 TLS
- [ ] 容器以非 root 用戶運行
- [ ] 網路策略限制存取
- [ ] 定期應用安全更新

### 環境特定安全性

```bash
# 開發環境
NODE_ENV=development
ENABLE_CSRF_PROTECTION=false
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
WEBHOOK_SIGNATURE_REQUIRED=false

# 預發布環境
NODE_ENV=staging
ENABLE_CSRF_PROTECTION=true
CORS_ORIGIN=https://staging.flakeguard.dev
WEBHOOK_SIGNATURE_REQUIRED=true

# 生產環境
NODE_ENV=production
ENABLE_CSRF_PROTECTION=true
CORS_ORIGIN=https://flakeguard.dev,https://app.flakeguard.dev
WEBHOOK_SIGNATURE_REQUIRED=true
ENABLE_AUDIT_LOGGING=true
```

### 秘密輪換排程

| 秘密類型 | 輪換頻率 | 自動輪換 | 備註 |
|----------|----------|----------|------|
| JWT 秘密 | 90 天 | ❌ | 使所有現有令牌失效 |
| API 金鑰 | 60 天 | ❌ | 可以增量輪換 |
| Webhook 秘密 | 180 天 | ❌ | 必須更新 GitHub/Slack 配置 |
| GitHub 應用程式金鑰 | 365 天 | ❌ | 在 GitHub 中生成新金鑰 |
| 資料庫密碼 | 30 天 | ✅ | 使用託管資料庫輪換 |
| TLS 憑證 | 90 天 | ✅ | 使用 cert-manager 或類似工具 |

### 監控與告警

```yaml
# Prometheus 告警
groups:
- name: flakeguard-security
  rules:
  - alert: HighFailedWebhookVerifications
    expr: rate(flakeguard_webhook_verifications_total{status="failed"}[5m]) > 0.1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: Webhook 驗證失敗率過高
      
  - alert: RateLimitExceeded
    expr: rate(flakeguard_security_events_total{type="rate_limit"}[5m]) > 1
    for: 1m
    labels:
      severity: warning
    annotations:
      summary: 多個客戶端達到流量限制
```

## 安全聯絡方式

如需安全問題，請遵循我們的 [安全政策](SECURITY.md)：

- **安全郵箱**：security@flakeguard.dev
- **PGP 金鑰**：[可在 SECURITY.md 取得](SECURITY.md#pgp-key)
- **回應時間**：關鍵問題 24-48 小時

## 參考資料

- [OWASP API 安全前十大](https://owasp.org/www-project-api-security/)
- [GitHub Webhook 安全](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)
- [Slack 請求驗證](https://api.slack.com/authentication/verifying-requests-from-slack)
- [內容安全政策參考](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)