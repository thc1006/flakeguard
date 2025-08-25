# FlakeGuard 部署指南

## 快速開始

透過我們完整的部署指南，讓 FlakeGuard 在生產環境中運行。

### 先決條件

- **Docker** 24.0+ 含 Compose v2
- **Kubernetes** 1.28+（生產環境）
- **Node.js** 20+（開發環境）
- **PostgreSQL** 16+ 
- **Redis** 7+

### 🚀 生產環境部署（5 分鐘）

```bash
# 1. 複製專案庫
git clone https://github.com/flakeguard/flakeguard.git
cd flakeguard

# 2. 設定環境變數
cp .env.example .env.production
# 編輯 .env.production 填入您的設定

# 3. 建立 Docker secrets
./scripts/create-secrets.sh

# 4. 使用 Docker Compose 部署
docker-compose -f docker-compose.prod.yml up -d

# 5. 初始化資料庫
docker-compose -f docker-compose.prod.yml exec api pnpm migrate:deploy
docker-compose -f docker-compose.prod.yml exec api pnpm seed

# 6. 驗證部署
curl https://your-domain.com/health
```

## 部署選項

### 1. Docker Compose（建議中小型部署使用）

**優點**：設定簡單、整合監控、易於維護
**適用於**：單一伺服器、測試環境、小型團隊

```bash
# 生產環境部署
docker-compose -f docker-compose.prod.yml up -d

# 開發環境
docker-compose -f docker-compose.dev.yml up -d

# 含監控功能
docker-compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

### 2. Kubernetes（企業級部署）

**優點**：高可用性、自動擴展、企業級功能
**適用於**：大規模部署、多區域、企業環境

```bash
# 部署 Kubernetes manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets/
kubectl apply -f k8s/configmaps/
kubectl apply -f k8s/production/

# 驗證部署
kubectl get pods -n flakeguard
kubectl get services -n flakeguard
```

### 3. 雲端平台

#### AWS ECS
```bash
# 使用 AWS CLI 部署
aws ecs create-cluster --cluster-name flakeguard
./scripts/deploy-ecs.sh
```

#### Google Cloud Run
```bash
# 部署至 Cloud Run
gcloud run deploy flakeguard-api \
  --image ghcr.io/flakeguard/flakeguard-api:latest \
  --platform managed
```

#### Azure Container Instances
```bash
# 部署至 Azure
az container create \
  --resource-group flakeguard \
  --name flakeguard-api \
  --image ghcr.io/flakeguard/flakeguard-api:latest
```

## 設定

### 環境變數

#### 核心設定
```env
# 應用程式
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
VERSION=latest

# 資料庫
DATABASE_URL=postgresql://user:pass@host:5432/flakeguard
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://host:6379
REDIS_PASSWORD=secure_password

# 安全設定
JWT_SECRET=your-super-secure-jwt-secret-minimum-32-chars
API_KEY=your-api-key-minimum-16-chars
WEBHOOK_SECRET=your-webhook-secret
```

#### GitHub 整合
```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="FAKE_PRIVATE_KEY_FOR_TESTS"
GITHUB_WEBHOOK_SECRET=your-github-webhook-secret
```

#### Slack 整合（可選）
```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
```

### 生產環境安全設定

```env
# HTTPS 和安全設定
HTTPS_ENABLED=true
SSL_CERT_PATH=/etc/ssl/certs/flakeguard.crt
SSL_KEY_PATH=/etc/ssl/private/flakeguard.key

# CORS 設定
CORS_ORIGIN=https://your-domain.com
CORS_CREDENTIALS=true

# 速率限制
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=1000

# Session 安全
SESSION_SECRET=your-session-secret-minimum-32-chars
SECURE_COOKIES=true
SAME_SITE_COOKIES=strict
```

## 基礎設施需求

### 最低需求

| 元件 | CPU | 記憶體 | 儲存空間 | 網路 |
|------|-----|--------|----------|------|
| API 伺服器 | 0.5 核心 | 512MB | 1GB | 100Mbps |
| Web 儀表板 | 0.25 核心 | 256MB | 512MB | 50Mbps |
| Worker | 0.5 核心 | 512MB | 2GB | 100Mbps |
| PostgreSQL | 1 核心 | 1GB | 20GB | 100Mbps |
| Redis | 0.25 核心 | 256MB | 1GB | 50Mbps |

### 建議生產環境設定

| 元件 | CPU | 記憶體 | 儲存空間 | 副本數量 |
|------|-----|--------|----------|----------|
| API 伺服器 | 1 核心 | 1GB | 2GB | 2-3 |
| Web 儀表板 | 0.5 核心 | 512MB | 1GB | 2 |
| Worker | 1 核心 | 1GB | 5GB | 3-5 |
| PostgreSQL | 2 核心 | 4GB | 100GB | 1 (HA) |
| Redis | 1 核心 | 1GB | 10GB | 1 (HA) |

### 高可用性設定

```yaml
# 負載平衡器設定
nginx:
  replicas: 2
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

# API 伺服器自動擴展設定
api:
  replicas: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPU: 70
    targetMemory: 80
```

## 資料庫設定

### PostgreSQL 設定

#### 安裝
```bash
# 使用 Docker
docker run -d \
  --name flakeguard-postgres \
  -e POSTGRES_DB=flakeguard \
  -e POSTGRES_USER=flakeguard \
  -e POSTGRES_PASSWORD=secure_password \
  -p 5432:5432 \
  postgres:16-alpine

# 使用套件管理器（Ubuntu）
sudo apt update
sudo apt install postgresql-16 postgresql-contrib
```

#### 資料庫初始化
```bash
# 建立資料庫和使用者
sudo -u postgres psql -c "CREATE DATABASE flakeguard;"
sudo -u postgres psql -c "CREATE USER flakeguard WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE flakeguard TO flakeguard;"

# 執行資料庫遷移
pnpm --filter=@flakeguard/api migrate:deploy

# 載入初始資料
pnpm --filter=@flakeguard/api seed
```

#### 效能調校
```sql
-- PostgreSQL 生產環境設定
-- 加入至 postgresql.conf

# 記憶體設定
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# 連線設定
max_connections = 200
shared_preload_libraries = 'pg_stat_statements'

# 日誌記錄
log_statement = 'mod'
log_duration = on
log_min_duration_statement = 1000

# 效能優化
random_page_cost = 1.1
effective_io_concurrency = 200
```

### Redis 設定

#### 安裝
```bash
# 使用 Docker
docker run -d \
  --name flakeguard-redis \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --requirepass secure_password

# 使用套件管理器
sudo apt install redis-server
```

#### Redis 設定
```conf
# redis.conf 生產環境設定

# 記憶體管理
maxmemory 512mb
maxmemory-policy allkeys-lru

# 資料持久化
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# 安全設定
requirepass secure_password
bind 127.0.0.1

# 效能優化
tcp-keepalive 60
timeout 300
```

## 監控與日誌

### Prometheus 設定
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

### Grafana 儀表板

預設儀表板包含：
- **應用程式效能**：回應時間、吞吐量、錯誤率
- **基礎設施**：CPU、記憶體、磁碟、網路使用率
- **業務指標**：測試處理量、失敗偵測率
- **安全性**：漏洞掃描、認證失敗次數

### 日誌設定

```yaml
# 日誌設定
logging:
  level: info
  format: json
  outputs:
    - console
    - file: /var/log/flakeguard/app.log
  
  # 結構化日誌
  fields:
    service: flakeguard-api
    version: ${VERSION}
    environment: ${NODE_ENV}
```

## SSL/TLS 設定

### Let's Encrypt（建議）
```bash
# 安裝 Certbot
sudo apt install certbot python3-certbot-nginx

# 生成憑證
sudo certbot --nginx -d your-domain.com

# 自動更新
sudo crontab -e
# 加入：0 12 * * * /usr/bin/certbot renew --quiet
```

### 自訂憑證
```bash
# 生成自簽憑證（開發環境）
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 生產環境憑證設定
sudo cp your-domain.crt /etc/ssl/certs/
sudo cp your-domain.key /etc/ssl/private/
sudo chmod 600 /etc/ssl/private/your-domain.key
```

### Nginx SSL 設定
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

    # 安全標頭
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

## 備份與復原

### 資料庫備份
```bash
# 自動化備份腳本
#!/bin/bash
BACKUP_DIR="/backups/postgres"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="flakeguard_backup_${DATE}.sql"

# 建立備份
pg_dump -h localhost -U flakeguard flakeguard > "${BACKUP_DIR}/${BACKUP_FILE}"

# 壓縮備份
gzip "${BACKUP_DIR}/${BACKUP_FILE}"

# 清理舊備份（保留最近 7 天）
find "${BACKUP_DIR}" -name "*.gz" -mtime +7 -delete
```

### Redis 備份
```bash
# Redis 備份腳本
#!/bin/bash
BACKUP_DIR="/backups/redis"
DATE=$(date +"%Y%m%d_%H%M%S")

# 建立 Redis 備份
redis-cli --rdb "${BACKUP_DIR}/dump_${DATE}.rdb"

# 清理舊備份
find "${BACKUP_DIR}" -name "*.rdb" -mtime +3 -delete
```

### 復原程序
```bash
# 資料庫復原
gunzip -c backup_file.sql.gz | psql -h localhost -U flakeguard flakeguard

# Redis 復原
redis-cli FLUSHALL
redis-cli --rdb dump.rdb
sudo systemctl restart redis
```

## 效能優化

### 應用程式效能
```env
# Node.js 優化
NODE_OPTIONS="--max-old-space-size=2048 --optimize-for-size"
UV_THREADPOOL_SIZE=8

# 資料庫連線池
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
DATABASE_IDLE_TIMEOUT=30000
DATABASE_CONNECTION_TIMEOUT=60000

# Redis 優化
REDIS_POOL_SIZE=10
REDIS_RETRY_ATTEMPTS=3
REDIS_RETRY_DELAY=1000
```

### 快取策略
```yaml
# 快取設定
cache:
  # 應用程式快取
  app:
    ttl: 300
    max_size: 1000

  # API 回應快取
  api:
    ttl: 60
    max_size: 500

  # 靜態資源快取
  static:
    ttl: 86400
    max_size: 10000
```

### 資料庫優化
```sql
-- 索引優化
CREATE INDEX CONCURRENTLY idx_test_cases_repo_name 
ON test_cases(repository_id, test_name);

CREATE INDEX CONCURRENTLY idx_workflow_runs_created 
ON workflow_runs(created_at DESC);

-- 查詢優化
ANALYZE;
REINDEX DATABASE flakeguard;
```

## 擴展策略

### 水平擴展
```yaml
# Kubernetes HPA 設定
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

### 負載平衡
```nginx
# Nginx upstream 設定
upstream flakeguard_api {
    least_conn;
    server api-1:3000 max_fails=3 fail_timeout=30s;
    server api-2:3000 max_fails=3 fail_timeout=30s;
    server api-3:3000 max_fails=3 fail_timeout=30s;
    
    # 健康檢查
    keepalive 32;
}

upstream flakeguard_web {
    least_conn;
    server web-1:3001 max_fails=3 fail_timeout=30s;
    server web-2:3001 max_fails=3 fail_timeout=30s;
    
    keepalive 32;
}
```

## 安全強化

### 容器安全
```dockerfile
# 安全強化的 Dockerfile 實踐
FROM node:20-alpine AS runtime

# 建立非 root 使用者
RUN addgroup -g 1001 -S flakeguard && \
    adduser -S -D -H -u 1001 -s /sbin/nologin flakeguard -G flakeguard

# 設定安全權限
RUN chmod 755 /app && \
    chown -R flakeguard:flakeguard /app

USER flakeguard

# 安全標籤
LABEL security.scan="trivy" \
      security.hardened="true" \
      security.rootless="true"
```

### 網路安全
```yaml
# 網路政策（Kubernetes）
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

### 機密管理
```bash
# 使用 Docker Secrets
echo "secret-value" | docker secret create jwt_secret -

# 使用 Kubernetes Secrets
kubectl create secret generic flakeguard-secrets \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=api-key="$(openssl rand -base64 24)"

# 使用 HashiCorp Vault
vault kv put secret/flakeguard \
  jwt_secret="$(openssl rand -base64 32)" \
  api_key="$(openssl rand -base64 24)"
```

## 疑難排解

### 常見問題

#### 應用程式無法啟動
```bash
# 檢查日誌
docker-compose logs api
kubectl logs -f deployment/flakeguard-api

# 檢查環境變數
docker-compose exec api env | grep -E "(DATABASE|REDIS|JWT)"

# 測試資料庫連線
docker-compose exec api node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$queryRaw\`SELECT 1\`.then(console.log).catch(console.error);
"
```

#### 資料庫連線問題
```bash
# 測試 PostgreSQL 連線
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "SELECT version();"

# 檢查連線限制
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "
SELECT count(*) as active_connections, 
       setting::int as max_connections
FROM pg_stat_activity, pg_settings 
WHERE name='max_connections';
"

# 重設連線
docker-compose restart postgres
```

#### Redis 連線問題
```bash
# 測試 Redis 連線
docker-compose exec redis redis-cli ping

# 檢查 Redis 資訊
docker-compose exec redis redis-cli info server

# 清除 Redis 快取
docker-compose exec redis redis-cli flushall
```

#### SSL 憑證問題
```bash
# 檢查憑證到期日
openssl x509 -in /etc/ssl/certs/your-domain.crt -noout -dates

# 驗證憑證鏈
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# 更新 Let's Encrypt 憑證
sudo certbot renew --force-renewal
```

### 效能問題

#### 高記憶體使用率
```bash
# 監控記憶體使用率
docker stats
kubectl top pods

# 分析 Node.js heap
docker-compose exec api node --inspect=0.0.0.0:9229 dist/server.js

# 優化資料庫查詢
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "
SELECT query, calls, mean_time, total_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;
"
```

#### 高 CPU 使用率
```bash
# 效能分析
docker-compose exec api node --prof dist/server.js

# 資料庫查詢分析
docker-compose exec postgres psql -U flakeguard -d flakeguard -c "
SELECT query, calls, mean_time, stddev_time 
FROM pg_stat_statements 
WHERE mean_time > 1000 
ORDER BY mean_time DESC;
"
```

### 復原程序

#### 完整系統復原
```bash
# 1. 停止所有服務
docker-compose down

# 2. 從備份還原資料庫
gunzip -c /backups/postgres/latest_backup.sql.gz | \
  docker-compose exec -T postgres psql -U flakeguard flakeguard

# 3. 還原 Redis 資料
docker-compose exec redis redis-cli --rdb /backups/redis/latest_dump.rdb

# 4. 啟動服務
docker-compose up -d

# 5. 驗證功能
curl https://your-domain.com/health
```

## 支援與維護

### 定期維護任務

#### 每日
- 監控系統健康狀態和日誌
- 檢查備份完成狀況
- 檢視安全警告

#### 每週  
- 更新安全修補程式
- 分析效能指標
- 清理舊日誌和備份

#### 每月
- 檢視並輪換機密
- 更新相依套件
- 容量規劃檢討

### 支援管道

- **文件**：[FlakeGuard Wiki](https://github.com/flakeguard/flakeguard/wiki)
- **問題回報**：[GitHub Issues](https://github.com/flakeguard/flakeguard/issues)
- **討論區**：[GitHub Discussions](https://github.com/flakeguard/flakeguard/discussions)
- **安全問題**：security@flakeguard.dev

---

如需更多部署方案和進階設定，請參考我們的[進階部署指南](./DEPLOYMENT-ADVANCED.md)。