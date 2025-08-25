# Multi-Tenant Architecture Guide

FlakeGuard supports enterprise-grade multi-tenancy, allowing a single deployment to serve multiple organizations while maintaining strict data isolation and security.

## Overview

### Key Features

- **Complete Data Isolation**: Each organization's data is strictly separated
- **Row-Level Security**: PostgreSQL RLS policies enforce tenant boundaries
- **Scalable Architecture**: Support for thousands of organizations
- **Flexible User Management**: Role-based access control within organizations
- **Usage Tracking**: Per-tenant quotas and billing integration
- **Audit Logging**: Comprehensive activity tracking for compliance

### Architecture Components

```
┌─────────────────────────────────────────────────────────┐
│                     Load Balancer                       │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│                  Fastify API Server                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Tenant Isolation Plugin              │    │
│  │  • Extract tenant context from requests        │    │
│  │  • Validate organization membership            │    │
│  │  • Auto-inject orgId into database queries     │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│                 PostgreSQL Database                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Row-Level Security (RLS)              │    │
│  │  • Organization table (tenant root)            │    │
│  │  • All data tables have orgId foreign key      │    │
│  │  • RLS policies enforce tenant isolation       │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Core Models

### Organization
The root tenant entity that owns all data within the system.

```typescript
interface Organization {
  id: string;
  name: string;
  slug: string; // Unique identifier for URLs
  githubLogin?: string; // GitHub organization login
  domain?: string; // Email domain for auto-assignment
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'deleted';
  settings: TenantSettings;
}
```

### OrganizationUser
Maps users to organizations with role-based permissions.

```typescript
interface OrganizationUser {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'suspended' | 'pending';
}
```

### Role Hierarchy
- **Owner**: Full control, can manage billing and delete organization
- **Admin**: Manage members, repositories, and settings
- **Member**: Access repositories and basic functionality
- **Viewer**: Read-only access to data

## Tenant Isolation

### Database Level

All tenant-aware tables include an `orgId` column with foreign key constraints:

```sql
-- Example: Repository table with tenant isolation
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL, -- Tenant isolation key
    "name" TEXT NOT NULL,
    -- ... other fields
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

-- Row-Level Security policy
CREATE POLICY tenant_isolation_repository ON "Repository" 
    FOR ALL USING ("orgId" = current_setting('app.current_tenant_id', true));
```

### Application Level

The **Tenant Isolation Plugin** ensures automatic tenant scoping:

1. **Request Context Extraction**: Identifies organization from:
   - GitHub installation ID (webhooks)
   - User authentication (JWT/session)
   - API key (organization-scoped)

2. **Query Interception**: Automatically adds `orgId` filters to:
   - SELECT queries (findMany, findFirst, count)
   - INSERT queries (create, createMany)
   - UPDATE queries (update, updateMany)
   - DELETE queries (delete, deleteMany)

3. **Access Validation**: Verifies user membership and permissions

## API Routes

### Organization Management (`/v1/organization`)

```typescript
// Get current organization details
GET /v1/organization
Response: {
  organization: Organization,
  userRole: string,
  usage: UsageMetrics,
  quotas: TenantQuotas
}

// Update organization settings
PUT /v1/organization/settings
Body: Partial<TenantSettings>

// List members
GET /v1/organization/members?page=1&limit=20&role=admin

// Invite user
POST /v1/organization/members/invite
Body: { email: string, role: string, name?: string }

// Update member role
PUT /v1/organization/members/:userId/role
Body: { role: string }

// Remove member
DELETE /v1/organization/members/:userId

// List repositories
GET /v1/organization/repositories?active=true&hasActions=true

// Sync repositories
POST /v1/organization/repositories/sync
Body: { fullSync: boolean, enabledOnly: boolean }

// Get usage metrics
GET /v1/organization/usage?period=monthly

// Get audit logs
GET /v1/organization/audit-logs?page=1&limit=50
```

### Admin Management (`/admin`)

Super-admin routes for system management (requires `super_admin` role):

```typescript
// Dashboard overview
GET /admin/dashboard

// List all organizations
GET /admin/organizations?page=1&status=active&plan=pro

// Create organization
POST /admin/organizations
Body: OrganizationConfig & { ownerEmail: string }

// Update organization
PUT /admin/organizations/:orgId
Body: Partial<Organization>

// Get organization details
GET /admin/organizations/:orgId

// Trigger organization sync
POST /admin/organizations/:orgId/sync
Body: SyncOptions

// System health
GET /admin/health
```

## Services

### TenantManagementService

Handles organization lifecycle and user management:

```typescript
class TenantManagementService {
  // Create new organization with owner
  async createOrganization(config: OrganizationConfig, owner: User)
  
  // Update organization settings
  async updateOrganizationSettings(orgId: string, settings: TenantSettings)
  
  // Invite user to organization
  async inviteUser(orgId: string, invitation: UserInvitation)
  
  // Remove user from organization
  async removeUser(orgId: string, userId: string)
  
  // Get usage metrics and quota status
  async getOrganizationUsage(orgId: string)
  async checkQuotaLimits(orgId: string)
}
```

### OrganizationSyncService

Manages repository discovery and synchronization:

```typescript
class OrganizationSyncService {
  // Sync all repositories for organization
  async syncOrganization(options: SyncOptions): Promise<SyncResult>
  
  // Discover repositories with GitHub Actions
  async discoverRepositories(installation: Installation)
  
  // Schedule periodic sync
  async schedulePeriodicSync(orgId: string, intervalHours: number)
  
  // Get sync status
  async getSyncStatus(orgId: string)
}
```

## Configuration

### Tenant Settings

Each organization can configure:

```typescript
interface TenantSettings {
  // Flake detection thresholds
  defaultFlakeThreshold: number; // 0.0 to 1.0
  autoQuarantineEnabled: boolean;
  
  // Slack integration
  slackIntegration?: {
    enabled: boolean;
    channelId?: string;
    notificationTypes: string[];
  };
  
  // Notification preferences
  notifications: {
    email: boolean;
    slack: boolean;
    webhook?: string;
  };
  
  // Policy rules
  policies: {
    excludePaths: string[]; // Glob patterns
    includeOnly: string[];
    quarantineRules: Array<{
      threshold: number;
      minOccurrences: number;
      timeWindow: string;
    }>;
  };
}
```

### Quotas and Billing

Per-plan resource limits:

```typescript
interface TenantQuotas {
  maxRepositories: number; // -1 for unlimited
  maxTestRuns: number;
  maxApiCalls: number;
  maxStorageMB: number;
  retentionDays: number;
}

// Plan quotas
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
    maxRepositories: -1, // Unlimited
    maxTestRuns: -1,
    maxApiCalls: -1,
    maxStorageMB: -1,
    retentionDays: 365,
  },
};
```

## Usage Tracking

### Metrics Collection

Automatic tracking of:
- API calls per organization
- Test runs processed
- Storage usage (MB)
- Active repositories
- User activity

### Implementation

```typescript
// Usage tracking middleware
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

## Audit Logging

### Comprehensive Activity Tracking

All organization activities are logged:

```typescript
interface AuditLog {
  orgId: string;
  userId?: string; // null for system events
  action: string; // create, update, delete, access
  resource: string; // installation, repository, test
  resourceId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
```

### Common Actions
- `organization_created`, `organization_updated`
- `user_invited`, `user_removed`, `member_role_updated`
- `repository_registered`, `repository_updated`
- `installation_sync_triggered`
- `settings_updated`

## Security Considerations

### Row-Level Security (RLS)

PostgreSQL RLS policies ensure data isolation:

```sql
-- Enable RLS on all tenant tables
ALTER TABLE "Repository" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TestResult" ENABLE ROW LEVEL SECURITY;
-- ... etc

-- Create isolation policies
CREATE POLICY tenant_isolation_repository ON "Repository" 
    FOR ALL USING ("orgId" = current_setting('app.current_tenant_id', true));
```

### Application Security

- **Input Validation**: All tenant inputs validated with Zod schemas
- **SQL Injection Prevention**: Prisma ORM with parameterized queries
- **Access Control**: Role-based permissions enforced at API level
- **Rate Limiting**: Per-organization API quotas
- **Audit Trails**: Complete activity logging for compliance

### GitHub Integration Security

- **Installation Isolation**: Each GitHub App installation maps to one organization
- **Token Management**: Installation access tokens scoped to organization
- **Webhook Verification**: HMAC signature validation for all webhooks
- **Permission Validation**: GitHub permissions verified before API calls

## Migration Guide

### From Single-Tenant to Multi-Tenant

1. **Run Migration Script**:
   ```bash
   # Apply schema migration
   psql -d flakeguard -f apps/api/prisma/migrations/add-multi-tenant-support.sql
   ```

2. **Update Application Configuration**:
   ```typescript
   // Enable tenant isolation
   tenantIsolation: {
     enabled: true,
     defaultOrgSlug: 'default',
   }
   ```

3. **Create Default Organization**:
   ```typescript
   // Existing data gets assigned to default organization
   const defaultOrg = await prisma.organization.create({
     data: {
       name: 'Default Organization',
       slug: 'default',
       plan: 'free',
       status: 'active',
     },
   });
   ```

## Performance Optimization

### Database Optimization

- **Partitioning**: Large tables partitioned by `orgId`
- **Indexing**: Compound indexes include `orgId` as first column
- **Connection Pooling**: Separate pools for different tenant tiers
- **Query Optimization**: Tenant-aware query patterns

### Caching Strategy

- **Redis**: Tenant-scoped caching keys
- **CDN**: Static assets cached per organization
- **Application Cache**: Installation tokens cached by `orgId`

### Example Indexes

```sql
-- Compound indexes for multi-tenant queries
CREATE INDEX "Repository_orgId_fullName_idx" ON "Repository"("orgId", "fullName");
CREATE INDEX "CheckRun_orgId_repositoryId_idx" ON "CheckRun"("orgId", "repositoryId");
CREATE INDEX "TestResult_orgId_status_idx" ON "TestResult"("orgId", "status");
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
```

## Monitoring and Alerting

### Tenant Health Monitoring

- **Organization Status**: Active, suspended, deleted counts
- **Usage Metrics**: API calls, storage, test runs per tenant
- **Quota Violations**: Alert when organizations exceed limits
- **Sync Health**: Repository synchronization status
- **Error Rates**: Per-tenant error monitoring

### Admin Dashboard Metrics

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

## Scaling Considerations

### Horizontal Scaling

- **API Servers**: Stateless design enables horizontal scaling
- **Database**: Read replicas for tenant-aware queries
- **Background Jobs**: Tenant-aware job queues
- **File Storage**: Tenant-partitioned object storage

### Vertical Scaling

- **Database Partitioning**: Partition large tables by `orgId`
- **Sharding Strategy**: Distribute tenants across database shards
- **Resource Isolation**: CPU/memory limits per tenant tier

### Example Sharding

```typescript
// Tenant routing based on orgId hash
function getShardForOrg(orgId: string): string {
  const hash = hashFunction(orgId);
  const shardIndex = hash % SHARD_COUNT;
  return `shard-${shardIndex}`;
}
```

## Backup and Recovery

### Tenant-Aware Backups

- **Per-Organization Backups**: Individual tenant data exports
- **Point-in-Time Recovery**: Tenant-scoped PITR
- **Cross-Region Replication**: Disaster recovery setup

### Data Retention

- **Automated Cleanup**: Remove expired data per tenant retention policy
- **Archive Strategy**: Move old data to cold storage
- **Compliance**: GDPR/CCPA data deletion requests

## Best Practices

### Development

1. **Always Test Tenant Isolation**: Verify queries include `orgId` filters
2. **Use TypeScript**: Strong typing prevents tenant context errors  
3. **Audit Trail Everything**: Log all tenant-related actions
4. **Performance Testing**: Test with realistic tenant counts
5. **Security Reviews**: Regular security audits of tenant boundaries

### Operations

1. **Monitor Tenant Health**: Dashboard for tenant status and metrics
2. **Quota Management**: Proactive quota violation alerts
3. **Backup Verification**: Regular recovery testing
4. **Performance Monitoring**: Per-tenant performance metrics
5. **Incident Response**: Tenant-aware incident procedures

This architecture provides enterprise-grade multi-tenancy with complete data isolation, flexible user management, and scalable performance characteristics suitable for serving thousands of organizations.