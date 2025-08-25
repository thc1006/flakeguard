# 多租戶架構指南

FlakeGuard 支援企業級多租戶功能，允許單一部署為多個組織提供服務，同時維持嚴格的資料隔離和安全性。

## 概覽

### 主要特性

- **完整資料隔離**：每個組織的資料都嚴格分離
- **列級安全性**：PostgreSQL RLS 政策強制執行租戶邊界
- **可擴展架構**：支援數千個組織
- **靈活的使用者管理**：組織內基於角色的存取控制
- **使用量追蹤**：每租戶配額和計費整合
- **審計日誌**：合規性的全面活動追蹤

### 架構組件

```
┌─────────────────────────────────────────────────────────┐
│                     負載平衡器                          │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│                  Fastify API 伺服器                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │              租戶隔離外掛程式                    │    │
│  │  • 從請求中提取租戶上下文                      │    │
│  │  • 驗證組織成員資格                           │    │
│  │  • 自動將 orgId 注入資料庫查詢                │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│                 PostgreSQL 資料庫                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │              列級安全性 (RLS)                   │    │
│  │  • Organization 表（租戶根）                   │    │
│  │  • 所有資料表都有 orgId 外鍵                   │    │
│  │  • RLS 政策強制執行租戶隔離                   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 核心模型

### Organization（組織）
擁有系統內所有資料的根租戶實體。

```typescript
interface Organization {
  id: string;
  name: string;
  slug: string; // URL 的唯一識別符
  githubLogin?: string; // GitHub 組織登入名
  domain?: string; // 自動分配的電子郵件域名
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'deleted';
  settings: TenantSettings;
}
```

### OrganizationUser（組織使用者）
將使用者映射到具有基於角色權限的組織。

```typescript
interface OrganizationUser {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'suspended' | 'pending';
}
```

### 角色層級
- **Owner（擁有者）**：完全控制，可管理帳單和刪除組織
- **Admin（管理員）**：管理成員、儲存庫和設定
- **Member（成員）**：存取儲存庫和基本功能
- **Viewer（檢視者）**：資料的唯讀存取

## 租戶隔離

### 資料庫層級

所有租戶感知表都包含具有外鍵約束的 `orgId` 欄位：

```sql
-- 範例：具有租戶隔離的 Repository 表
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL, -- 租戶隔離金鑰
    "name" TEXT NOT NULL,
    -- ... 其他欄位
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

-- 列級安全性政策
CREATE POLICY tenant_isolation_repository ON "Repository" 
    FOR ALL USING ("orgId" = current_setting('app.current_tenant_id', true));
```

### 應用程式層級

**租戶隔離外掛程式**確保自動租戶範圍設定：

1. **請求上下文提取**：從以下來源識別組織：
   - GitHub 安裝 ID（webhooks）
   - 使用者認證（JWT/session）
   - API 金鑰（組織範圍）

2. **查詢攔截**：自動新增 `orgId` 篩選器到：
   - SELECT 查詢（findMany、findFirst、count）
   - INSERT 查詢（create、createMany）
   - UPDATE 查詢（update、updateMany）
   - DELETE 查詢（delete、deleteMany）

3. **存取驗證**：驗證使用者成員資格和權限

## API 路由

### 組織管理（`/v1/organization`）

```typescript
// 取得目前組織詳細資訊
GET /v1/organization
回應: {
  organization: Organization,
  userRole: string,
  usage: UsageMetrics,
  quotas: TenantQuotas
}

// 更新組織設定
PUT /v1/organization/settings
主體: Partial<TenantSettings>

// 列出成員
GET /v1/organization/members?page=1&limit=20&role=admin

// 邀請使用者
POST /v1/organization/members/invite
主體: { email: string, role: string, name?: string }

// 更新成員角色
PUT /v1/organization/members/:userId/role
主體: { role: string }

// 移除成員
DELETE /v1/organization/members/:userId

// 列出儲存庫
GET /v1/organization/repositories?active=true&hasActions=true

// 同步儲存庫
POST /v1/organization/repositories/sync
主體: { fullSync: boolean, enabledOnly: boolean }

// 取得使用量指標
GET /v1/organization/usage?period=monthly

// 取得審計日誌
GET /v1/organization/audit-logs?page=1&limit=50
```

### 管理員管理（`/admin`）

系統管理的超級管理員路由（需要 `super_admin` 角色）：

```typescript
// 儀表板總覽
GET /admin/dashboard

// 列出所有組織
GET /admin/organizations?page=1&status=active&plan=pro

// 建立組織
POST /admin/organizations
主體: OrganizationConfig & { ownerEmail: string }

// 更新組織
PUT /admin/organizations/:orgId
主體: Partial<Organization>

// 取得組織詳細資訊
GET /admin/organizations/:orgId

// 觸發組織同步
POST /admin/organizations/:orgId/sync
主體: SyncOptions

// 系統健康狀況
GET /admin/health
```

## 服務

### TenantManagementService（租戶管理服務）

處理組織生命週期和使用者管理：

```typescript
class TenantManagementService {
  // 建立具有擁有者的新組織
  async createOrganization(config: OrganizationConfig, owner: User)
  
  // 更新組織設定
  async updateOrganizationSettings(orgId: string, settings: TenantSettings)
  
  // 邀請使用者到組織
  async inviteUser(orgId: string, invitation: UserInvitation)
  
  // 從組織中移除使用者
  async removeUser(orgId: string, userId: string)
  
  // 取得使用量指標和配額狀態
  async getOrganizationUsage(orgId: string)
  async checkQuotaLimits(orgId: string)
}
```

### OrganizationSyncService（組織同步服務）

管理儲存庫發現和同步：

```typescript
class OrganizationSyncService {
  // 同步組織的所有儲存庫
  async syncOrganization(options: SyncOptions): Promise<SyncResult>
  
  // 發現具有 GitHub Actions 的儲存庫
  async discoverRepositories(installation: Installation)
  
  // 排程定期同步
  async schedulePeriodicSync(orgId: string, intervalHours: number)
  
  // 取得同步狀態
  async getSyncStatus(orgId: string)
}
```

## 設定

### 租戶設定

每個組織可以設定：

```typescript
interface TenantSettings {
  // 不穩定測試檢測門檻
  defaultFlakeThreshold: number; // 0.0 到 1.0
  autoQuarantineEnabled: boolean;
  
  // Slack 整合
  slackIntegration?: {
    enabled: boolean;
    channelId?: string;
    notificationTypes: string[];
  };
  
  // 通知偏好
  notifications: {
    email: boolean;
    slack: boolean;
    webhook?: string;
  };
  
  // 政策規則
  policies: {
    excludePaths: string[]; // Glob 模式
    includeOnly: string[];
    quarantineRules: Array<{
      threshold: number;
      minOccurrences: number;
      timeWindow: string;
    }>;
  };
}
```

### 配額和計費

每個方案的資源限制：

```typescript
interface TenantQuotas {
  maxRepositories: number; // -1 表示無限制
  maxTestRuns: number;
  maxApiCalls: number;
  maxStorageMB: number;
  retentionDays: number;
}

// 方案配額
const PLAN_QUOTAS = {
  free: {
    maxRepositories: 5,
    maxTestRuns: 1000,
    maxApiCalls: 10000,
    maxStorageMB: 100,
    retentionDays: 30,
  },
  pro: {
    maxRepositories: 50,
    maxTestRuns: 10000,
    maxApiCalls: 100000,
    maxStorageMB: 1000,
    retentionDays: 90,
  },
  enterprise: {
    maxRepositories: -1, // 無限制
    maxTestRuns: -1,
    maxApiCalls: -1,
    maxStorageMB: -1,
    retentionDays: 365,
  },
};
```

## 使用量追蹤

### 指標收集

自動追蹤：
- 每個組織的 API 呼叫
- 處理的測試執行
- 儲存使用量（MB）
- 活躍儲存庫
- 使用者活動

### 實作

```typescript
// 使用量追蹤中間軟體
fastify.addHook('onResponse', async (request, reply) => {
  if (!request.tenant || request.method === 'GET') return;

  await prisma.usageMetric.upsert({
    where: {
      orgId_metricType_period_date: {
        orgId: request.tenant.orgId,
        metricType: 'api_calls',
        period: 'daily',
        date: new Date().toISOString().split('T')[0],
      },
    },
    create: {
      orgId: request.tenant.orgId,
      metricType: 'api_calls',
      period: 'daily',
      date: new Date(),
      value: 1,
    },
    update: {
      value: { increment: 1 },
    },
  });
});
```

## 審計日誌

### 全面的活動追蹤

所有組織活動都會被記錄：

```typescript
interface AuditLog {
  orgId: string;
  userId?: string; // 系統事件為 null
  action: string; // create、update、delete、access
  resource: string; // installation、repository、test
  resourceId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
```

### 常見動作
- `organization_created`、`organization_updated`
- `user_invited`、`user_removed`、`member_role_updated`
- `repository_registered`、`repository_updated`
- `installation_sync_triggered`
- `settings_updated`

## 安全性考量

### 列級安全性（RLS）

PostgreSQL RLS 政策確保資料隔離：

```sql
-- 在所有租戶表上啟用 RLS
ALTER TABLE "Repository" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TestResult" ENABLE ROW LEVEL SECURITY;
-- ... 等

-- 建立隔離政策
CREATE POLICY tenant_isolation_repository ON "Repository" 
    FOR ALL USING ("orgId" = current_setting('app.current_tenant_id', true));
```

### 應用程式安全性

- **輸入驗證**：使用 Zod 模式驗證所有租戶輸入
- **SQL 注入防護**：使用參數化查詢的 Prisma ORM
- **存取控制**：在 API 層級強制執行基於角色的權限
- **速率限制**：每組織 API 配額
- **審計軌跡**：合規性的完整活動記錄

### GitHub 整合安全性

- **安裝隔離**：每個 GitHub App 安裝映射到一個組織
- **令牌管理**：安裝存取令牌範圍限定為組織
- **Webhook 驗證**：所有 webhooks 的 HMAC 簽名驗證
- **權限驗證**：API 呼叫前驗證 GitHub 權限

## 移轉指南

### 從單租戶到多租戶

1. **執行移轉指令碼**：
   ```bash
   # 套用模式移轉
   psql -d flakeguard -f apps/api/prisma/migrations/add-multi-tenant-support.sql
   ```

2. **更新應用程式設定**：
   ```typescript
   // 啟用租戶隔離
   tenantIsolation: {
     enabled: true,
     defaultOrgSlug: 'default',
   }
   ```

3. **建立預設組織**：
   ```typescript
   // 現有資料被分配給預設組織
   const defaultOrg = await prisma.organization.create({
     data: {
       name: 'Default Organization',
       slug: 'default',
       plan: 'free',
       status: 'active',
     },
   });
   ```

## 效能最佳化

### 資料庫最佳化

- **分割**：大型表依 `orgId` 分割
- **索引**：複合索引包含 `orgId` 作為第一欄
- **連線池**：不同租戶層級的獨立池
- **查詢最佳化**：租戶感知查詢模式

### 快取策略

- **Redis**：租戶範圍的快取金鑰
- **CDN**：每組織快取靜態資產
- **應用程式快取**：依 `orgId` 快取安裝令牌

### 索引範例

```sql
-- 多租戶查詢的複合索引
CREATE INDEX "Repository_orgId_fullName_idx" ON "Repository"("orgId", "fullName");
CREATE INDEX "CheckRun_orgId_repositoryId_idx" ON "CheckRun"("orgId", "repositoryId");
CREATE INDEX "TestResult_orgId_status_idx" ON "TestResult"("orgId", "status");
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
```

## 監控和警報

### 租戶健康監控

- **組織狀態**：活躍、暫停、刪除計數
- **使用量指標**：每租戶的 API 呼叫、儲存、測試執行
- **配額違規**：組織超過限制時的警報
- **同步健康**：儲存庫同步狀態
- **錯誤率**：每租戶錯誤監控

### 管理員儀表板指標

```typescript
interface DashboardMetrics {
  totalOrganizations: number;
  activeOrganizations: number;
  totalUsers: number;
  totalRepositories: number;
  totalTestRuns: number;
  recentActivity: AuditLog[];
  systemHealth: {
    database: string;
    errors: { last24h: number };
    sync: { status: Record<string, number> };
  };
}
```

## 擴展考量

### 水平擴展

- **API 伺服器**：無狀態設計實現水平擴展
- **資料庫**：租戶感知查詢的讀取副本
- **背景工作**：租戶感知工作佇列
- **檔案儲存**：租戶分割的物件儲存

### 垂直擴展

- **資料庫分割**：依 `orgId` 分割大型表
- **分片策略**：跨資料庫分片分散租戶
- **資源隔離**：每租戶層級的 CPU/記憶體限制

### 分片範例

```typescript
// 基於 orgId 雜湊的租戶路由
function getShardForOrg(orgId: string): string {
  const hash = hashFunction(orgId);
  const shardIndex = hash % SHARD_COUNT;
  return `shard-${shardIndex}`;
}
```

## 備份和恢復

### 租戶感知備份

- **每組織備份**：個別租戶資料匯出
- **時點恢復**：租戶範圍的 PITR
- **跨區域複寫**：災害恢復設定

### 資料保留

- **自動清理**：依租戶保留政策移除過期資料
- **存檔策略**：將舊資料移至冷儲存
- **合規性**：GDPR/CCPA 資料刪除請求

## 最佳實務

### 開發

1. **始終測試租戶隔離**：驗證查詢包含 `orgId` 篩選器
2. **使用 TypeScript**：強型別防止租戶上下文錯誤
3. **審計軌跡一切**：記錄所有租戶相關動作
4. **效能測試**：使用實際租戶數量進行測試
5. **安全性檢查**：定期租戶邊界安全審查

### 營運

1. **監控租戶健康**：租戶狀態和指標的儀表板
2. **配額管理**：主動的配額違規警報
3. **備份驗證**：定期恢復測試
4. **效能監控**：每租戶效能指標
5. **事件回應**：租戶感知的事件處理程序

此架構提供企業級多租戶功能，具有完整的資料隔離、靈活的使用者管理和可擴展的效能特性，適合為數千個組織提供服務。