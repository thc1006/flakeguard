# Architecture Overview

FlakeGuard is designed as a modern, scalable microservices architecture that processes test results from GitHub Actions workflows and provides intelligent flakiness detection and analysis.

## High-Level Architecture

```mermaid
graph TB
    subgraph "GitHub"
        GH[GitHub Actions]
        WH[Webhooks]
        API_GH[GitHub API]
    end
    
    subgraph "FlakeGuard Core"
        LB[Load Balancer]
        API[API Server<br/>Fastify]
        WORKER[Worker Service<br/>BullMQ]
        WEB[Web Dashboard<br/>Next.js]
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL<br/>Test Results)]
        REDIS[(Redis<br/>Job Queue)]
        S3[(S3/Blob<br/>Artifacts)]
    end
    
    subgraph "Integrations"
        SLACK[Slack]
        EMAIL[Email]
        WEBHOOK[Custom Webhooks]
    end
    
    subgraph "Monitoring"
        METRICS[Prometheus]
        LOGS[Centralized Logging]
        ALERTS[Alerting]
    end
    
    GH -->|Artifacts| S3
    GH -->|Webhooks| WH
    WH --> LB
    LB --> API
    API --> REDIS
    API --> PG
    API <--> API_GH
    
    REDIS --> WORKER
    WORKER --> PG
    WORKER --> S3
    WORKER --> SLACK
    WORKER --> EMAIL
    WORKER --> WEBHOOK
    
    WEB --> API
    
    API --> METRICS
    WORKER --> METRICS
    API --> LOGS
    WORKER --> LOGS
    
    METRICS --> ALERTS
    LOGS --> ALERTS
```

## Core Components

### API Server (Fastify)
The central hub that handles:
- **GitHub Webhook Processing** - Receives and validates GitHub events
- **REST API Endpoints** - Provides data access for clients
- **Authentication & Authorization** - Secures access to resources
- **Rate Limiting** - Prevents abuse and ensures stability
- **Request Validation** - Validates all incoming requests using Zod schemas

### Worker Service (BullMQ)
Background job processor that handles:
- **Artifact Download** - Retrieves JUnit XML files from GitHub
- **Test Result Parsing** - Extracts test data from various formats
- **Flakiness Analysis** - Runs detection algorithms on test data
- **Report Generation** - Creates comprehensive analysis reports
- **Integration Processing** - Sends notifications to external services

### Web Dashboard (Next.js)
User interface providing:
- **Test Analytics** - Visual dashboards and trends
- **Repository Management** - Configure settings per repository
- **Quarantine Management** - Review and manage quarantined tests
- **User Management** - Team access and permissions

### Data Storage

#### PostgreSQL
Primary database storing:
- **Test Results** - Individual test executions and outcomes
- **Flakiness Scores** - Calculated flakiness metrics over time
- **Repository Metadata** - Configuration and settings
- **User Data** - Authentication and authorization information
- **Audit Logs** - System activity and changes

#### Redis
High-performance cache and queue system:
- **Job Queue** - BullMQ job processing
- **Session Storage** - User sessions and temporary data
- **Rate Limiting** - Request throttling counters
- **Caching** - Frequently accessed data

#### Object Storage (S3/Blob)
File storage for:
- **Test Artifacts** - Downloaded JUnit XML files
- **Generated Reports** - HTML and JSON analysis reports
- **Backups** - Database and configuration backups

## Data Flow Architecture

```mermaid
sequenceDiagram
    participant GHA as GitHub Actions
    participant GH as GitHub API
    participant API as FlakeGuard API
    participant Q as Redis Queue
    participant W as Worker
    participant DB as PostgreSQL
    participant S3 as Object Storage
    
    GHA->>GHA: Run tests, generate JUnit XML
    GHA->>GH: Upload artifacts
    GHA->>API: Send webhook (workflow completed)
    
    API->>API: Validate webhook signature
    API->>API: Parse webhook payload
    API->>Q: Enqueue processing job
    API-->>GHA: Return 200 OK
    
    Q->>W: Dequeue job
    W->>GH: Download artifacts
    W->>S3: Store artifacts
    W->>W: Parse JUnit XML
    W->>DB: Store test results
    W->>W: Calculate flakiness scores
    W->>DB: Update flakiness data
    W->>W: Generate analysis report
    W->>GH: Create Check Run with results
    
    Note over W,DB: If configured
    W->>W: Check quarantine thresholds
    W->>DB: Update quarantine status
    W-->>GH: Create issue for quarantined tests
```

## Deployment Architectures

### Development Environment

```mermaid
graph TB
    subgraph "Developer Machine"
        DEV_API[API Server :3000]
        DEV_WORKER[Worker :3001]
        DEV_WEB[Web Dashboard :3002]
        DEV_DOCS[Docs Site :3003]
    end
    
    subgraph "Docker Compose"
        PG_DEV[PostgreSQL :5432]
        REDIS_DEV[Redis :6379]
        PGADMIN[pgAdmin :5050]
    end
    
    DEV_API --> PG_DEV
    DEV_API --> REDIS_DEV
    DEV_WORKER --> PG_DEV
    DEV_WORKER --> REDIS_DEV
    DEV_WEB --> DEV_API
```

### Production Environment

```mermaid
graph TB
    subgraph "Load Balancer"
        LB[NGINX/CloudFlare]
    end
    
    subgraph "Application Tier"
        API1[API Server 1]
        API2[API Server 2]
        API3[API Server 3]
        
        W1[Worker 1]
        W2[Worker 2]
        W3[Worker 3]
        
        WEB1[Web Dashboard]
    end
    
    subgraph "Data Tier"
        PG_MASTER[(PostgreSQL Primary)]
        PG_REPLICA[(PostgreSQL Replica)]
        REDIS_CLUSTER[(Redis Cluster)]
        S3_PROD[(S3 Bucket)]
    end
    
    subgraph "Monitoring"
        PROM[Prometheus]
        GRAF[Grafana]
        JAEGER[Jaeger Tracing]
    end
    
    LB --> API1
    LB --> API2  
    LB --> API3
    LB --> WEB1
    
    API1 --> PG_MASTER
    API2 --> PG_MASTER
    API3 --> PG_MASTER
    
    API1 --> REDIS_CLUSTER
    API2 --> REDIS_CLUSTER
    API3 --> REDIS_CLUSTER
    
    W1 --> PG_MASTER
    W2 --> PG_MASTER
    W3 --> PG_MASTER
    
    W1 --> REDIS_CLUSTER
    W2 --> REDIS_CLUSTER
    W3 --> REDIS_CLUSTER
    
    W1 --> S3_PROD
    W2 --> S3_PROD
    W3 --> S3_PROD
    
    WEB1 --> API1
    
    API1 --> PROM
    API2 --> PROM
    API3 --> PROM
    W1 --> PROM
    W2 --> PROM
    W3 --> PROM
```

## Technology Stack

### Backend Services

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js 20+ | JavaScript/TypeScript execution |
| **API Framework** | Fastify 4 | High-performance web framework |
| **Worker Queue** | BullMQ | Reliable job processing |
| **Database ORM** | Prisma 5 | Type-safe database access |
| **Validation** | Zod | Runtime type validation |
| **Logging** | Pino | High-performance logging |

### Data Storage

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Primary Database** | PostgreSQL 16 | ACID transactions, complex queries |
| **Cache & Queue** | Redis 7 | High-performance caching and queuing |
| **Object Storage** | S3/Compatible | Scalable file storage |
| **Search** | PostgreSQL Full-Text | Test result search and filtering |

### Frontend & Documentation

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Web Dashboard** | Next.js 14 | React-based web application |
| **Documentation** | Docusaurus 3 | Developer documentation site |
| **UI Components** | Tailwind CSS | Utility-first styling |
| **Charts & Analytics** | Recharts | Data visualization |

### DevOps & Monitoring

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Containerization** | Docker | Application packaging |
| **Orchestration** | Docker Compose/K8s | Service deployment |
| **Monitoring** | Prometheus | Metrics collection |
| **Visualization** | Grafana | Metrics dashboards |
| **Tracing** | Jaeger | Distributed tracing |
| **Logging** | ELK Stack | Centralized log management |

## Security Architecture

```mermaid
graph TB
    subgraph "External"
        GH[GitHub]
        USER[Users]
        SLACK[Slack]
    end
    
    subgraph "Security Layer"
        WAF[Web Application Firewall]
        RATE[Rate Limiting]
        AUTH[Authentication]
        AUTHZ[Authorization]
        CRYPTO[Encryption]
    end
    
    subgraph "Application"
        API[API Server]
        WORKER[Worker]
        WEB[Web Dashboard]
    end
    
    subgraph "Data"
        PG[(Encrypted DB)]
        REDIS[(Encrypted Cache)]
        S3[(Encrypted Storage)]
    end
    
    GH -->|HMAC-SHA256| WAF
    USER --> WAF
    SLACK --> WAF
    
    WAF --> RATE
    RATE --> AUTH
    AUTH --> AUTHZ
    AUTHZ --> API
    
    API --> CRYPTO
    WORKER --> CRYPTO
    WEB --> CRYPTO
    
    CRYPTO --> PG
    CRYPTO --> REDIS
    CRYPTO --> S3
```

### Security Features

- **Webhook Signature Validation** - HMAC-SHA256 verification of GitHub webhooks
- **JWT Authentication** - Stateless authentication for API access
- **Role-Based Access Control** - Granular permissions for different user roles
- **Rate Limiting** - Per-endpoint and per-user request throttling
- **Input Validation** - Comprehensive validation using Zod schemas
- **Encryption at Rest** - Database and file encryption
- **Encryption in Transit** - TLS 1.3 for all communication
- **Audit Logging** - Complete audit trail of all system activities

## Scalability Considerations

### Horizontal Scaling

- **API Servers** - Stateless design allows unlimited horizontal scaling
- **Workers** - Multiple worker instances can process jobs in parallel
- **Database Reads** - Read replicas for analytics and reporting queries
- **Caching** - Redis clustering for high-availability caching

### Performance Optimization

- **Connection Pooling** - Optimized database connection management
- **Query Optimization** - Indexed queries and efficient data access patterns  
- **Lazy Loading** - On-demand data loading in the web interface
- **CDN Integration** - Static asset delivery via CDN
- **Compression** - Gzip/Brotli compression for all HTTP responses

### Resource Management

- **Memory Management** - Efficient memory usage patterns
- **CPU Optimization** - Non-blocking I/O and efficient algorithms
- **Disk I/O** - Optimized database queries and file operations
- **Network** - Minimal data transfer and efficient protocols

This architecture ensures FlakeGuard can scale from small teams to enterprise deployments while maintaining reliability, security, and performance.

## Next Steps

- [System Design Details](./system-design.md)
- [Component Relationships](./component-diagram.md)
- [Data Flow Patterns](./data-flow.md)
- [Sequence Diagrams](./sequence-diagrams.md)