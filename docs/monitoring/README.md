# FlakeGuard Monitoring & Observability Guide

This guide provides comprehensive documentation for FlakeGuard's monitoring, observability, and SLO (Service Level Objectives) implementation following SRE best practices.

## 🎯 Overview

FlakeGuard implements production-grade observability with:

- **Comprehensive Metrics**: Prometheus metrics for API, workers, and business logic
- **SLO-based Alerting**: Multi-window burn-rate alerts following Google SRE practices  
- **Error Budget Management**: Automated tracking and alerting on SLO compliance
- **Multi-tier Notifications**: Intelligent routing and escalation policies
- **Rich Dashboards**: Grafana dashboards for operational visibility

## 📊 Service Level Objectives (SLOs)

### Core SLOs

| SLO | Target | Error Budget | Description |
|-----|--------|--------------|-------------|
| **API Availability** | 99.9% | 0.1% | Successful responses to all API requests |
| **Ingestion Latency** | P95 < 30s | 5% | Time from webhook to parsed results |
| **Parse Success Rate** | 99% | 1% | JUnit XML parsing success rate |  
| **Check Run Delivery** | P95 < 60s | 5% | Time from parse to GitHub delivery |
| **Worker Processing** | P95 < 120s | 5% | Background job processing time |

### Error Budget Policies

- **High Severity** (API availability): Alert at 10% budget burn rate
- **Medium Severity** (Performance targets): Alert at 5% budget burn rate  
- **Low Severity** (Internal metrics): Alert at 2% budget burn rate

## 🚨 Multi-Window Burn-Rate Alerting

### Fast Burn Alerts (1h window)
Critical alerts for rapid error budget consumption:

- **API 5xx Rate Fast Burn**: 1440x normal rate (exhausts budget in 30min) → **PAGE**
- **Ingestion Error Fast Burn**: 72x normal rate (exhausts budget in 10h) → **PAGE**

### Slow Burn Alerts (6h window)  
Warning alerts for sustained elevated error rates:

- **API 5xx Rate Slow Burn**: 6x normal rate (exhausts budget in 5 days) → **WARNING**
- **Ingestion Error Slow Burn**: 6x normal rate (exhausts budget in 5 days) → **WARNING**

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   FlakeGuard    │───▶│   Prometheus    │───▶│   Grafana       │
│   Services      │    │   (Metrics)     │    │  (Dashboards)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  Alertmanager   │───▶│  Notifications  │
                       │   (Routing)     │    │ (PagerDuty/Slack)│
                       └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### 1. Start Monitoring Stack

```bash
# Start monitoring infrastructure
docker-compose -f docker-compose.monitoring.yml up -d

# Verify services are healthy
curl http://localhost:9090/api/v1/query?query=up
curl http://localhost:3001/api/health
curl http://localhost:9093/api/v1/status
```

### 2. Access Dashboards

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin123)  
- **Alertmanager**: http://localhost:9093

### 3. Verify Metrics Collection

```bash
# Check API metrics
curl http://localhost:3000/metrics

# Check worker metrics (if running)
curl http://localhost:9090/metrics

# Query specific SLI
curl 'http://localhost:9090/api/v1/query?query=flakeguard:api_success_rate_5m'
```

## 📈 Key Metrics

### HTTP API Metrics
- `flakeguard_api_http_requests_total` - Total HTTP requests
- `flakeguard_api_http_request_duration_seconds` - Request latency
- `flakeguard_api_http_errors_total` - HTTP errors by type

### Ingestion Pipeline Metrics
- `flakeguard_api_ingestion_latency_seconds` - Webhook to parsed latency
- `flakeguard_api_parse_results_total` - Parse success/failure counts
- `flakeguard_api_check_run_delivery_seconds` - GitHub delivery time

### Business Metrics
- `flakeguard_api_tests_processed_total` - Tests processed by status
- `flakeguard_api_flake_detections_total` - Flaky tests detected
- `flakeguard_api_quarantine_actions_total` - Quarantine actions taken

### Worker Metrics
- `flakeguard_worker_jobs_processed_total` - Worker job completions
- `flakeguard_worker_queue_size` - Queue depths by status
- `flakeguard_worker_job_processing_duration_seconds` - Processing time

## 🔍 Troubleshooting

### Common Issues

#### High Memory Usage Alert
```bash
# Check memory metrics
curl 'http://localhost:9090/api/v1/query?query=flakeguard_api_memory_usage_bytes'

# Check for memory leaks in containers
docker stats flakeguard-api flakeguard-worker
```

#### Parse Error Rate Elevated  
```bash
# Query recent parse failures
curl 'http://localhost:9090/api/v1/query?query=rate(flakeguard_api_parse_results_total{result="failure"}[5m])'

# Check error logs
docker logs flakeguard-api | grep -i parse
```

#### Worker Queue Backlog
```bash
# Check queue depths
curl 'http://localhost:9090/api/v1/query?query=flakeguard_worker_queue_size{status="waiting"}'

# Scale workers if needed  
docker-compose up --scale worker=3
```

### Health Check Endpoints

#### API Health Checks
- `GET /health` - Basic health status
- `GET /health/ready` - Kubernetes readiness probe  
- `GET /health/live` - Kubernetes liveness probe
- `GET /health/detailed` - Comprehensive health with dependencies

#### Worker Health Checks
- Worker health is exposed via metrics at port 9090 (configurable)
- Database connectivity, Redis connectivity, queue health

## 📖 Runbooks

### API 5xx Error Rate High

1. **Immediate Actions**:
   ```bash
   # Check error distribution  
   curl 'http://localhost:9090/api/v1/query?query=rate(flakeguard_api_http_requests_total{status_code=~"5.."}[5m]) by (route, method)'
   
   # Check error logs
   docker logs flakeguard-api --since=10m | grep -i error
   ```

2. **Investigation**:
   - Check database connectivity: `GET /health/detailed`  
   - Verify external service dependencies
   - Review resource utilization (CPU, memory)

3. **Mitigation**:
   - Scale API instances if CPU/memory constrained
   - Enable circuit breakers for external dependencies
   - Consider feature flags to disable non-critical features

### Ingestion Latency SLO Breach

1. **Immediate Actions**:
   ```bash
   # Check ingestion performance
   curl 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95, rate(flakeguard_api_ingestion_latency_seconds_bucket[5m]))'
   
   # Check worker queue depths
   curl 'http://localhost:9090/api/v1/query?query=flakeguard_worker_queue_size{status="waiting"}'
   ```

2. **Investigation**:
   - Identify bottlenecks: parsing, database writes, external API calls
   - Check for large test suites or malformed XML
   - Verify worker scalability

3. **Mitigation**:
   - Scale worker processes: `docker-compose up --scale worker=5`
   - Implement async processing for non-critical operations
   - Add request queuing and prioritization

## 📊 Dashboard Guide

### FlakeGuard Overview Dashboard

**Key Panels**:
1. **Service Health Score** - Aggregated health (0-1 scale)
2. **SLO Compliance** - Real-time SLO adherence
3. **Error Budget Burn Rate** - Current budget consumption
4. **Request Rate & Latency** - API performance trends
5. **Business Metrics** - Tests processed, flakes detected

**Recommended Alerts**:
- Service health score < 0.95 for 5 minutes
- Any SLO below target for 10 minutes
- Error budget burn rate > 10x normal for 2 minutes

### Creating Custom Dashboards

```json
{
  "title": "Custom FlakeGuard Dashboard",
  "panels": [
    {
      "title": "Repository Activity",
      "targets": [
        {
          "expr": "rate(flakeguard_api_tests_processed_total[5m]) by (repository)",
          "legendFormat": "{{repository}}"
        }
      ]
    }
  ]
}
```

## 🔧 Configuration

### Prometheus Configuration
- **Scrape Interval**: 15s for application metrics, 30s for infrastructure
- **Retention**: 30 days, 50GB storage limit
- **Recording Rules**: Pre-computed SLI calculations for efficiency

### Alertmanager Configuration  
- **Routing**: Severity-based routing with team assignments
- **Grouping**: By alertname, service, component
- **Throttling**: 5m group intervals, 12h repeat intervals
- **Escalation**: Page → Warn → Info severity levels

### Grafana Configuration
- **Data Sources**: Prometheus for metrics, logs integration optional
- **Dashboards**: Auto-provisioned from JSON files
- **Users**: LDAP/OAuth integration for enterprise deployments

## 🌐 Internationalization (中文支持)

FlakeGuard monitoring supports bilingual documentation:

### 中文监控文档

**核心SLO目标**:
- API可用性: 99.9% (年停机时间 < 8.7小时)
- 摄取延迟: P95 < 30秒
- 解析成功率: 99%
- 检查运行交付: P95 < 60秒

**多窗口燃烧率告警**:
- 快速燃烧 (1小时): 严重告警，需要立即处理
- 慢速燃烧 (6小时): 警告告警，需要调查和修复

**监控端点**:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001  
- Alertmanager: http://localhost:9093

## 📚 Additional Resources

- [Google SRE Book - SLI/SLO Practices](https://sre.google/sre-book/service-level-objectives/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [Grafana Dashboard Design Guide](https://grafana.com/docs/grafana/latest/best-practices/)
- [Multi-Window Burn Rate Alerts](https://sre.google/workbook/alerting-on-slos/)

## 🤝 Contributing

To improve monitoring and observability:

1. **Add New Metrics**: Follow naming conventions `flakeguard_<component>_<metric>_<unit>`
2. **Update SLOs**: Modify `monitoring/slo-definitions.yaml`
3. **Add Alerts**: Update `monitoring/prometheus-alerts.yaml`
4. **Create Dashboards**: Add JSON to `monitoring/grafana/`

## 📞 Support

For monitoring-related issues:
- **SRE On-Call**: Critical alerts auto-page via PagerDuty
- **Dev Team**: #flakeguard-alerts Slack channel
- **Documentation**: This guide and inline runbook links