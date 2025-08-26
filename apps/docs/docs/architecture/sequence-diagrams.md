# Sequence Diagrams

This document provides detailed sequence diagrams showing how FlakeGuard processes different types of events and workflows.

## Webhook Processing Flow

### GitHub Workflow Completion

```mermaid
sequenceDiagram
    participant GHA as GitHub Actions
    participant GH as GitHub API
    participant LB as Load Balancer
    participant API as FlakeGuard API
    participant Q as Redis Queue
    participant W as Worker
    participant DB as PostgreSQL
    participant S3 as Object Storage
    
    Note over GHA,S3: Test execution and artifact upload
    GHA->>GHA: Execute test workflow
    GHA->>GHA: Generate JUnit XML files
    GHA->>GH: Upload test artifacts
    GHA->>GH: Workflow status: completed
    
    Note over GH,API: Webhook delivery
    GH->>LB: POST /api/github/webhook
    Note right of GH: Headers:<br/>X-GitHub-Event: workflow_run<br/>X-Hub-Signature-256: sha256=...
    
    LB->>API: Forward webhook
    API->>API: Validate HMAC signature
    API->>API: Parse webhook payload
    API->>API: Extract workflow metadata
    
    alt Invalid signature
        API-->>LB: 401 Unauthorized
        LB-->>GH: 401 Unauthorized
    else Valid webhook
        API->>Q: Enqueue ProcessWorkflowJob
        Note right of API: Job data:<br/>- workflow_run_id<br/>- repository<br/>- artifacts_url
        API-->>LB: 200 OK
        LB-->>GH: 200 OK
    end
    
    Note over Q,S3: Background processing
    Q->>W: Dequeue ProcessWorkflowJob
    W->>W: Authenticate with GitHub
    W->>GH: GET /repos/{owner}/{repo}/actions/runs/{id}/artifacts
    GH-->>W: Return artifacts list
    
    loop For each test artifact
        W->>GH: Download artifact ZIP
        GH-->>W: Return artifact content
        W->>S3: Store artifact
        W->>W: Extract and parse JUnit XML
        W->>W: Normalize test results
        W->>DB: Upsert test results
    end
    
    W->>W: Calculate flakiness scores
    W->>DB: Update flakiness metrics
    W->>W: Generate analysis report
    W->>GH: Create Check Run
    
    Note right of W: Check run includes:<br/>- Flakiness summary<br/>- Individual test scores<br/>- Quarantine recommendations
    
    alt Quarantine threshold exceeded
        W->>DB: Mark tests for quarantine
        W->>GH: Create/update issue
        W->>W: Send Slack notification
    end
```

### Check Run Requested Action Flow

```mermaid
sequenceDiagram
    participant USER as User
    participant GH as GitHub UI
    participant API as FlakeGuard API
    participant Q as Redis Queue
    participant W as Worker
    participant DB as PostgreSQL
    participant SLACK as Slack
    
    Note over USER,SLACK: User initiates action from Check Run
    USER->>GH: Click "Quarantine Test" button
    GH->>API: POST /api/github/webhook
    Note right of GH: Headers:<br/>X-GitHub-Event: check_run<br/>Action: requested_action
    
    API->>API: Validate webhook signature
    API->>API: Parse requested action
    
    alt Action: quarantine_test
        API->>Q: Enqueue QuarantineTestJob
        Note right of API: Job data:<br/>- test_identifier<br/>- repository<br/>- user_id
        API-->>GH: 200 OK
        
        Q->>W: Dequeue QuarantineTestJob
        W->>DB: Update test quarantine status
        W->>DB: Log quarantine action
        
        W->>GH: Update Check Run
        Note right of W: Update summary:<br/>"Test quarantined by {user}"
        
        W->>SLACK: Send notification
        Note right of W: Slack message:<br/>"Test {name} quarantined<br/>by {user} in {repo}"
        
    else Action: ignore_flake
        API->>Q: Enqueue IgnoreFlakeJob
        API-->>GH: 200 OK
        
        Q->>W: Dequeue IgnoreFlakeJob
        W->>DB: Mark flake as ignored
        W->>DB: Log ignore action
        W->>GH: Update Check Run
        
    else Action: reanalyze
        API->>Q: Enqueue ReanalysisJob
        API-->>GH: 200 OK
        
        Q->>W: Dequeue ReanalysisJob
        W->>W: Recalculate flakiness scores
        W->>DB: Update analysis results
        W->>GH: Update Check Run with new results
        
    else Unknown action
        API-->>GH: 400 Bad Request
    end
```

## Flakiness Detection Pipeline

### Test Result Analysis

```mermaid
sequenceDiagram
    participant W as Worker
    participant DB as PostgreSQL
    participant ALGO as Analysis Engine
    participant SCORE as Scoring Service
    participant REPORT as Report Generator
    
    Note over W,REPORT: Test result processing pipeline
    W->>DB: Fetch historical test data
    Note right of W: Query for:<br/>- Last 100 runs<br/>- Same test name<br/>- Same repository<br/>- Last 30 days
    
    DB-->>W: Return test history
    
    W->>ALGO: Analyze failure patterns
    ALGO->>ALGO: Calculate failure rate
    ALGO->>ALGO: Detect pattern consistency
    ALGO->>ALGO: Analyze failure timing
    ALGO->>ALGO: Check error message similarity
    ALGO-->>W: Pattern analysis results
    
    W->>SCORE: Calculate flakiness score
    SCORE->>SCORE: Apply statistical models
    SCORE->>SCORE: Weight pattern factors
    SCORE->>SCORE: Calculate confidence level
    SCORE->>SCORE: Determine recommendation
    SCORE-->>W: Flakiness assessment
    
    Note right of SCORE: Score components:<br/>- Failure rate: 0.0-1.0<br/>- Pattern consistency<br/>- Confidence level<br/>- Recommendation action
    
    W->>DB: Store flakiness scores
    W->>REPORT: Generate detailed report
    
    REPORT->>REPORT: Format analysis results
    REPORT->>REPORT: Generate visualizations
    REPORT->>REPORT: Create recommendations
    REPORT-->>W: Formatted report
    
    alt Score > quarantine_threshold
        W->>DB: Mark test for quarantine
        Note right of W: Quarantine metadata:<br/>- Reason: high_flakiness<br/>- Score: {value}<br/>- Timestamp: {now}
    end
```

### Quarantine Decision Flow

```mermaid
sequenceDiagram
    participant W as Worker
    participant DB as PostgreSQL
    participant POLICY as Policy Engine
    participant GH as GitHub API
    participant SLACK as Slack
    
    Note over W,SLACK: Quarantine evaluation process
    W->>DB: Fetch quarantine policy
    DB-->>W: Return policy configuration
    
    Note right of DB: Policy settings:<br/>- warn_threshold: 0.3<br/>- quarantine_threshold: 0.6<br/>- min_runs: 5<br/>- recent_failures: 2
    
    W->>POLICY: Evaluate quarantine criteria
    POLICY->>POLICY: Check flakiness score >= threshold
    POLICY->>POLICY: Verify minimum run count
    POLICY->>POLICY: Check recent failure count
    POLICY->>POLICY: Validate historical data quality
    
    alt Quarantine criteria met
        POLICY-->>W: Recommend quarantine
        
        W->>DB: Begin transaction
        W->>DB: Update test status to quarantined
        W->>DB: Log quarantine decision
        W->>DB: Commit transaction
        
        W->>GH: Create GitHub issue
        Note right of W: Issue template:<br/>Title: "Quarantine Test: {name}"<br/>Body: Flakiness report<br/>Labels: flaky-test, quarantine
        
        W->>SLACK: Send team notification
        Note right of W: Slack notification:<br/>"⚠️ Test quarantined: {name}<br/>Flakiness score: {score}<br/>View details: {link}"
        
    else Warning criteria met
        POLICY-->>W: Recommend warning
        
        W->>DB: Update test status to warned
        W->>DB: Log warning decision
        
        W->>SLACK: Send warning notification
        Note right of W: "⚠️ Flaky test detected: {name}<br/>Score: {score} (warning level)"
        
    else Criteria not met
        POLICY-->>W: No action required
        W->>DB: Update analysis timestamp
    end
```

## Slack Integration Flow

### Notification Delivery

```mermaid
sequenceDiagram
    participant W as Worker
    participant Q as Redis Queue  
    participant SLACK_W as Slack Worker
    participant SLACK_API as Slack API
    participant DB as PostgreSQL
    
    Note over W,DB: Slack notification processing
    W->>Q: Enqueue SlackNotificationJob
    Note right of W: Job data:<br/>- channel_id<br/>- message_template<br/>- test_data<br/>- notification_type
    
    Q->>SLACK_W: Dequeue notification job
    SLACK_W->>DB: Fetch Slack configuration
    DB-->>SLACK_W: Return webhook URL and settings
    
    SLACK_W->>SLACK_W: Format message using template
    SLACK_W->>SLACK_W: Apply message enrichments
    
    Note right of SLACK_W: Message formatting:<br/>- Replace template variables<br/>- Add action buttons<br/>- Format code blocks<br/>- Add emojis and formatting
    
    SLACK_W->>SLACK_API: POST to webhook URL
    Note right of SLACK_W: Slack payload:<br/>- text: formatted message<br/>- attachments: test details<br/>- actions: quarantine/ignore buttons
    
    alt Delivery successful
        SLACK_API-->>SLACK_W: 200 OK
        SLACK_W->>DB: Log successful delivery
        
    else Delivery failed
        SLACK_API-->>SLACK_W: Error response
        SLACK_W->>Q: Requeue with backoff
        SLACK_W->>DB: Log delivery failure
        
        Note right of SLACK_W: Retry logic:<br/>- Max 3 retries<br/>- Exponential backoff<br/>- 1min, 5min, 15min delays
    end
```

### Interactive Action Handling

```mermaid
sequenceDiagram
    participant USER as User
    participant SLACK as Slack App
    participant API as FlakeGuard API
    participant Q as Redis Queue
    participant W as Worker
    participant DB as PostgreSQL
    participant GH as GitHub API
    
    Note over USER,GH: User interaction with Slack notification
    USER->>SLACK: Click "Quarantine Test" button
    SLACK->>API: POST /api/slack/actions
    Note right of SLACK: Headers:<br/>X-Slack-Signature<br/>Payload: action details
    
    API->>API: Verify Slack signature
    API->>API: Parse action payload
    API->>API: Extract user and test info
    
    alt Valid signature and action
        API->>Q: Enqueue QuarantineTestJob
        Note right of API: Job includes:<br/>- test_id<br/>- user_id (Slack)<br/>- source: slack_action
        
        API-->>SLACK: 200 OK with update
        Note right of API: Response updates message:<br/>"✅ Test queued for quarantine<br/>by {user.name}"
        
        Q->>W: Process quarantine job
        W->>DB: Update test status
        W->>DB: Log user action
        
        W->>GH: Update corresponding Check Run
        W->>SLACK: Send confirmation message
        Note right of W: "✅ Test {name} successfully<br/>quarantined by {user}"
        
    else Invalid action
        API-->>SLACK: 400 Bad Request
    end
```

## Error Handling and Recovery

### Webhook Processing Failures

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant API as FlakeGuard API
    participant Q as Redis Queue
    participant W as Worker
    participant DLQ as Dead Letter Queue
    participant ALERT as Alerting
    
    Note over GH,ALERT: Error handling in webhook processing
    GH->>API: POST /api/github/webhook
    
    alt Processing error
        API->>API: Processing fails
        API->>Q: Enqueue job with retry metadata
        API-->>GH: 500 Internal Server Error
        
        Note right of GH: GitHub retries:<br/>- Exponential backoff<br/>- Up to 5 attempts<br/>- 15min, 30min, 1hr, 2hr, 4hr
        
        Q->>W: Attempt job processing
        W->>W: Processing fails again
        W->>Q: Requeue with incremented retry count
        
        loop Until max retries
            Q->>W: Retry job processing
            
            alt Processing succeeds
                W->>W: Complete successfully
                break
            else Still failing
                W->>Q: Increment retry count
            end
        end
        
        alt Max retries exceeded
            Q->>DLQ: Move to dead letter queue
            DLQ->>ALERT: Trigger alert
            Note right of ALERT: Alert includes:<br/>- Webhook details<br/>- Error messages<br/>- Retry history
        end
        
    else Validation error
        API-->>GH: 400 Bad Request
        Note right of API: Don't retry validation errors
    end
```

### Service Recovery Patterns

```mermaid
sequenceDiagram
    participant LB as Load Balancer
    participant API1 as API Instance 1
    participant API2 as API Instance 2
    participant DB as PostgreSQL
    participant MONITOR as Health Monitor
    
    Note over LB,MONITOR: Service failure and recovery
    LB->>API1: Health check request
    
    alt Service healthy
        API1-->>LB: 200 OK
        
    else Service unhealthy
        API1-->>LB: 503 Service Unavailable
        LB->>API2: Route traffic to healthy instance
        
        MONITOR->>MONITOR: Detect unhealthy service
        MONITOR->>API1: Attempt service restart
        
        loop Until healthy or max attempts
            MONITOR->>API1: Check service status
            
            alt Service recovered
                API1-->>MONITOR: 200 OK
                MONITOR->>LB: Add instance back to pool
                break
            else Still unhealthy
                MONITOR->>MONITOR: Wait before retry
            end
        end
        
        alt Recovery failed
            MONITOR->>MONITOR: Escalate to on-call team
        end
    end
```

This comprehensive set of sequence diagrams provides detailed visibility into FlakeGuard's operational flows, helping developers understand the system behavior and troubleshoot issues effectively.

## Related Documentation

- [Architecture Overview](./overview.md)
- [Troubleshooting Guide](../troubleshooting/debugging-guide.md)
- [Webhook Processing](../concepts/webhook-processing.md)
- [Monitoring & Alerting](../monitoring/alerting.md)