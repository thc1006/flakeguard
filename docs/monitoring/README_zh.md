# FlakeGuard 监控与可观测性指南

本指南为FlakeGuard的监控、可观测性和SLO（服务等级目标）实施提供全面的文档，遵循SRE最佳实践。

## 🎯 概述

FlakeGuard实现了生产级可观测性，包括：

- **全面的指标**: API、工作器和业务逻辑的Prometheus指标
- **基于SLO的告警**: 遵循Google SRE实践的多窗口燃烧率告警
- **错误预算管理**: 自动跟踪和SLO合规性告警
- **多层通知**: 智能路由和升级策略
- **丰富的仪表板**: Grafana运营可视化仪表板

## 📊 服务等级目标 (SLOs)

### 核心SLO

| SLO | 目标 | 错误预算 | 描述 |
|-----|------|----------|------|
| **API可用性** | 99.9% | 0.1% | 对所有API请求的成功响应率 |
| **摄取延迟** | P95 < 30秒 | 5% | 从webhook到解析结果的时间 |
| **解析成功率** | 99% | 1% | JUnit XML解析成功率 |
| **检查运行交付** | P95 < 60秒 | 5% | 从解析到GitHub交付的时间 |
| **工作器处理** | P95 < 120秒 | 5% | 后台作业处理时间 |

### 错误预算策略

- **高严重性**（API可用性）：在10%预算燃烧率时告警
- **中严重性**（性能目标）：在5%预算燃烧率时告警
- **低严重性**（内部指标）：在2%预算燃烧率时告警

## 🚨 多窗口燃烧率告警

### 快速燃烧告警 (1小时窗口)
快速错误预算消耗的关键告警：

- **API 5xx率快速燃烧**: 1440倍正常率（30分钟内耗尽预算）→ **紧急**
- **摄取错误快速燃烧**: 72倍正常率（10小时内耗尽预算）→ **紧急**

### 慢速燃烧告警 (6小时窗口)
持续高错误率的警告告警：

- **API 5xx率慢速燃烧**: 6倍正常率（5天内耗尽预算）→ **警告**
- **摄取错误慢速燃烧**: 6倍正常率（5天内耗尽预算）→ **警告**

## 🏗️ 架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   FlakeGuard    │───▶│   Prometheus    │───▶│   Grafana       │
│     服务        │    │    (指标)       │    │   (仪表板)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │  Alertmanager   │───▶│     通知        │
                       │    (路由)       │    │ (PagerDuty/Slack)│
                       └─────────────────┘    └─────────────────┘
```

## 🚀 快速开始

### 1. 启动监控堆栈

```bash
# 启动监控基础设施
docker-compose -f docker-compose.monitoring.yml up -d

# 验证服务健康状态
curl http://localhost:9090/api/v1/query?query=up
curl http://localhost:3001/api/health
curl http://localhost:9093/api/v1/status
```

### 2. 访问仪表板

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin123)
- **Alertmanager**: http://localhost:9093

### 3. 验证指标收集

```bash
# 检查API指标
curl http://localhost:3000/metrics

# 检查工作器指标（如果运行中）
curl http://localhost:9090/metrics

# 查询特定SLI
curl 'http://localhost:9090/api/v1/query?query=flakeguard:api_success_rate_5m'
```

## 📈 关键指标

### HTTP API指标
- `flakeguard_api_http_requests_total` - HTTP请求总数
- `flakeguard_api_http_request_duration_seconds` - 请求延迟
- `flakeguard_api_http_errors_total` - 按类型分类的HTTP错误

### 摄取管道指标
- `flakeguard_api_ingestion_latency_seconds` - Webhook到解析的延迟
- `flakeguard_api_parse_results_total` - 解析成功/失败计数
- `flakeguard_api_check_run_delivery_seconds` - GitHub交付时间

### 业务指标
- `flakeguard_api_tests_processed_total` - 按状态处理的测试
- `flakeguard_api_flake_detections_total` - 检测到的不稳定测试
- `flakeguard_api_quarantine_actions_total` - 隔离操作

### 工作器指标
- `flakeguard_worker_jobs_processed_total` - 工作器作业完成情况
- `flakeguard_worker_queue_size` - 按状态分类的队列深度
- `flakeguard_worker_job_processing_duration_seconds` - 处理时间

## 🔍 故障排除

### 常见问题

#### 高内存使用告警
```bash
# 检查内存指标
curl 'http://localhost:9090/api/v1/query?query=flakeguard_api_memory_usage_bytes'

# 检查容器内存泄漏
docker stats flakeguard-api flakeguard-worker
```

#### 解析错误率升高
```bash
# 查询最近解析失败
curl 'http://localhost:9090/api/v1/query?query=rate(flakeguard_api_parse_results_total{result="failure"}[5m])'

# 检查错误日志
docker logs flakeguard-api | grep -i parse
```

#### 工作器队列积压
```bash
# 检查队列深度
curl 'http://localhost:9090/api/v1/query?query=flakeguard_worker_queue_size{status="waiting"}'

# 如需要可扩展工作器
docker-compose up --scale worker=3
```

### 健康检查端点

#### API健康检查
- `GET /health` - 基本健康状态
- `GET /health/ready` - Kubernetes就绪探针
- `GET /health/live` - Kubernetes存活探针
- `GET /health/detailed` - 包含依赖项的全面健康检查

#### 工作器健康检查
- 工作器健康状态通过端口9090的指标暴露（可配置）
- 数据库连接性、Redis连接性、队列健康状态

## 📖 运行手册

### API 5xx错误率高

1. **立即行动**：
   ```bash
   # 检查错误分布
   curl 'http://localhost:9090/api/v1/query?query=rate(flakeguard_api_http_requests_total{status_code=~"5.."}[5m]) by (route, method)'
   
   # 检查错误日志
   docker logs flakeguard-api --since=10m | grep -i error
   ```

2. **调查**：
   - 检查数据库连接性：`GET /health/detailed`
   - 验证外部服务依赖项
   - 审查资源利用率（CPU、内存）

3. **缓解措施**：
   - 如果CPU/内存受限，扩展API实例
   - 为外部依赖项启用熔断器
   - 考虑使用功能标志禁用非关键功能

### 摄取延迟SLO违约

1. **立即行动**：
   ```bash
   # 检查摄取性能
   curl 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95, rate(flakeguard_api_ingestion_latency_seconds_bucket[5m]))'
   
   # 检查工作器队列深度
   curl 'http://localhost:9090/api/v1/query?query=flakeguard_worker_queue_size{status="waiting"}'
   ```

2. **调查**：
   - 识别瓶颈：解析、数据库写入、外部API调用
   - 检查大型测试套件或格式错误的XML
   - 验证工作器可扩展性

3. **缓解措施**：
   - 扩展工作器进程：`docker-compose up --scale worker=5`
   - 为非关键操作实施异步处理
   - 添加请求队列和优先级排序

## 📊 仪表板指南

### FlakeGuard概览仪表板

**关键面板**：
1. **服务健康评分** - 聚合健康状态（0-1评分）
2. **SLO合规性** - 实时SLO遵守情况
3. **错误预算燃烧率** - 当前预算消耗
4. **请求率和延迟** - API性能趋势
5. **业务指标** - 处理的测试、检测到的不稳定性

**推荐告警**：
- 服务健康评分 < 0.95 持续5分钟
- 任何SLO低于目标持续10分钟
- 错误预算燃烧率 > 正常的10倍持续2分钟

### 创建自定义仪表板

```json
{
  "title": "自定义FlakeGuard仪表板",
  "panels": [
    {
      "title": "仓库活动",
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

## 🔧 配置

### Prometheus配置
- **抓取间隔**: 应用指标15秒，基础设施30秒
- **保留**: 30天，50GB存储限制
- **记录规则**: 预计算SLI计算以提高效率

### Alertmanager配置
- **路由**: 基于严重性的路由与团队分配
- **分组**: 按告警名称、服务、组件
- **限流**: 5分钟组间隔，12小时重复间隔
- **升级**: 紧急 → 警告 → 信息严重性等级

### Grafana配置
- **数据源**: Prometheus用于指标，日志集成可选
- **仪表板**: 从JSON文件自动配置
- **用户**: 企业部署的LDAP/OAuth集成

## 📚 其他资源

- [Google SRE手册 - SLI/SLO实践](https://sre.google/sre-book/service-level-objectives/)
- [Prometheus最佳实践](https://prometheus.io/docs/practices/)
- [Grafana仪表板设计指南](https://grafana.com/docs/grafana/latest/best-practices/)
- [多窗口燃烧率告警](https://sre.google/workbook/alerting-on-slos/)

## 🤝 贡献

改进监控和可观测性：

1. **添加新指标**: 遵循命名约定 `flakeguard_<组件>_<指标>_<单位>`
2. **更新SLO**: 修改 `monitoring/slo-definitions.yaml`
3. **添加告警**: 更新 `monitoring/prometheus-alerts.yaml`
4. **创建仪表板**: 将JSON添加到 `monitoring/grafana/`

## 📞 支持

监控相关问题：
- **SRE值班**: 关键告警通过PagerDuty自动呼叫
- **开发团队**: #flakeguard-alerts Slack频道
- **文档**: 本指南和内联运行手册链接

## 🌟 监控最佳实践

### 指标命名约定
```
flakeguard_<service>_<metric_name>_<unit>
例子:
- flakeguard_api_http_requests_total
- flakeguard_worker_job_processing_duration_seconds
- flakeguard_api_memory_usage_bytes
```

### SLI选择原则
- **用户面向**: 选择影响用户体验的指标
- **可控制的**: 选择团队可以直接影响的指标
- **简单的**: 避免复杂的计算或过多的依赖项

### 告警设计
- **可操作的**: 每个告警都应该有明确的修复步骤
- **有意义的**: 告警应该指示真实的用户影响
- **不冗余的**: 避免为同一问题设置多个告警

### 仪表板设计
- **目的驱动**: 每个仪表板应该服务特定的用例
- **分层信息**: 从高级概述到详细诊断
- **一致的布局**: 在所有仪表板中使用相同的视觉模式