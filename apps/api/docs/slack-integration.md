# FlakeGuard Slack Integration

FlakeGuard provides a comprehensive Slack bot for managing flaky tests directly from your team channels. This integration allows developers to quickly identify, analyze, and take action on flaky tests without leaving Slack.

## Features

### 🎯 Core Commands

- **`/flakeguard status <owner/repo>`** - Get comprehensive flaky test summary for a repository
- **`/flakeguard topflaky [limit]`** - View top flakiest tests across all monitored repositories  
- **`/flakeguard help`** - Display usage instructions and available commands

### 🎮 Interactive Actions

- **🚫 Quarantine Tests** - Automatically create quarantine branches and PRs in GitHub
- **🔗 Create Issues** - Generate detailed GitHub issues for flaky tests
- **📊 View Details** - Get in-depth analytics for specific tests

### 📊 Rich Analytics

- Flakiness confidence scores and failure rates
- Historical trend analysis
- Repository health scores with visual indicators
- Actionable recommendations based on test behavior

## Quick Start

### 1. Setup Slack App

1. Use the provided [slack-app-manifest.yaml](../slack-app-manifest.yaml) to create your Slack app
2. Install the app to your workspace
3. Copy the bot token and signing secret

### 2. Configure Environment

```bash
# Enable Slack integration
ENABLE_SLACK_APP=true

# Required Slack credentials
SLACK_SIGNING_SECRET="your-slack-signing-secret"
SLACK_BOT_TOKEN="xoxb-your-bot-token"

# Optional: Slack app server port (default: 3001)
SLACK_PORT=3001
```

### 3. Start the Application

```bash
npm run dev
```

The Slack app will start on port 3001 (or your configured `SLACK_PORT`) alongside the main API.

### 4. Test Integration

In any Slack channel where the bot is installed:

```
/flakeguard help
```

## Development Setup

### Local Development with ngrok

For local development, you'll need to expose your local server to Slack:

1. **Install ngrok**
   ```bash
   npm install -g ngrok
   # OR download from https://ngrok.com/download
   ```

2. **Start your local server**
   ```bash
   npm run dev
   ```

3. **Expose your Slack port**
   ```bash
   ngrok http 3001
   ```

4. **Update Slack app URLs**
   - Go to your Slack app settings
   - Update Request URLs to use your ngrok URL:
     - Event Subscriptions: `https://abc123.ngrok.io/slack/events`
     - Interactivity: `https://abc123.ngrok.io/slack/events`
     - Slash Commands: `https://abc123.ngrok.io/slack/events`

5. **Test the integration**
   ```
   /flakeguard help
   ```

### Environment Variables for Development

```bash
# Development-specific settings
NODE_ENV=development
LOG_LEVEL=debug
SLACK_PROCESS_BEFORE_RESPONSE=true

# Use your ngrok URL
NGROK_URL="https://abc123.ngrok.io"
```

## Command Reference

### Repository Status

Get a comprehensive overview of flaky tests in a specific repository:

```
/flakeguard status microsoft/typescript
```

**Response includes:**
- Total tests analyzed
- Number of flaky tests detected
- Quarantined tests count
- Repository health score
- Top 5 flakiest tests with interactive actions

**Health Score Indicators:**
- 🟢 90%+ (Excellent - minimal flakiness)
- 🟡 70-89% (Good - some flaky tests)  
- 🔴 <70% (Needs attention - significant flakiness)

### Top Flaky Tests

View the most problematic tests across all monitored repositories:

```
/flakeguard topflaky
/flakeguard topflaky 15  # Limit to top 15
```

**Response includes:**
- Test name and repository
- Flakiness confidence score
- Failure rate percentage
- Last failure timestamp
- Sorted by confidence score (highest first)

### Interactive Actions

When viewing test details, you can take immediate action:

- **🚫 Quarantine in GitHub**
  - Creates a quarantine branch
  - Modifies test files to add `.skip()` annotations
  - Opens a detailed pull request
  - Links back to Slack with results

- **🔗 Create Issue**
  - Opens a comprehensive GitHub issue
  - Includes flakiness analysis
  - Provides debugging recommendations
  - Tags with appropriate labels

- **📊 View Details**
  - Shows detailed test analytics
  - Historical performance data
  - Failure patterns and trends

## Message Formatting

### Status Message Structure

```
📊 FlakeGuard Status: facebook/react

Total Tests Analyzed: 150
Flaky Tests Found: 12 ⚠️  
Quarantined Tests: 3 🚫
Health Score: 85% 🟡

Top Flaky Tests:
1. ReactDOM.test.js::should render
   🎯 Flake Score: 87.5% | 💥 Failure Rate: 45.2%
   📅 Last Failure: 2024-01-15
   [Quarantine] [Create Issue] [View Details]
```

### Top Flaky Message Structure

```
🌍 Top 10 Flakiest Tests Across All Repositories

1. should render without crashing
   📁 Repository: facebook/react
   🎯 Flake Score: 92.3% | 💥 Failure Rate: 56.7%
   🔒 Confidence: 94.1% | 📅 Last Failure: 2024-01-15

2. async component loading
   📁 Repository: angular/angular  
   🎯 Flake Score: 88.9% | 💥 Failure Rate: 43.2%
   🔒 Confidence: 91.5% | 📅 Last Failure: 2024-01-14
```

## Error Handling

### Common Issues and Solutions

1. **"Repository not found"**
   - Ensure the repository is monitored by FlakeGuard
   - Check repository name format: `owner/repo`
   - Verify GitHub App installation

2. **"Rate limit exceeded"**
   - Wait a moment and try again
   - Default: 10 requests per minute per user
   - Contact admin if limits need adjustment

3. **"Failed to quarantine test"**
   - Check GitHub App permissions
   - Verify repository access
   - Ensure branch protection allows automated PRs

4. **"Slack app not responding"**
   - Check server logs for errors
   - Verify ngrok tunnel is active (development)
   - Confirm signing secret is correct

### Debug Information

Enable debug logging for troubleshooting:

```bash
LOG_LEVEL=debug
```

Check health endpoints:
- Main API: `GET /health/comprehensive`
- Slack app: `GET /slack/health`

## Security

### Request Verification

All Slack requests are verified using the signing secret:

```typescript
// Automatic verification in Bolt for JS
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // ...other config
});
```

### Rate Limiting

Per-user rate limiting prevents abuse:

- **Default**: 10 requests per minute per user
- **Window**: 60 seconds (sliding window)
- **Scope**: Per Slack user ID

### Data Privacy

- No repository code or sensitive data is stored in Slack
- Only test metadata and flakiness scores are shared
- All GitHub operations use existing app permissions
- User actions are logged for audit purposes

## Production Deployment

### Infrastructure Requirements

- **SSL/TLS**: Required for production Slack apps
- **Domain**: Stable domain name for webhook URLs
- **Monitoring**: Health checks and alerting
- **Logging**: Centralized log aggregation

### Configuration

```bash
# Production environment
NODE_ENV=production
ENABLE_SLACK_APP=true

# Use production URLs
SLACK_SIGNING_SECRET="prod-signing-secret"
SLACK_BOT_TOKEN="xoxb-prod-bot-token"

# Production server settings
SLACK_PORT=3001
SLACK_PROCESS_BEFORE_RESPONSE=true
```

### Monitoring

Monitor key metrics:

```bash
# Check Slack app health
curl https://your-api.com/slack/health

# Check comprehensive system health  
curl https://your-api.com/health/comprehensive
```

Set up alerts for:
- Slack app initialization failures
- High error rates in command processing
- GitHub API rate limit approaches
- Database connection issues

### Deployment Checklist

- [ ] Update Slack app manifest with production URLs
- [ ] Configure SSL certificates
- [ ] Set up monitoring and alerting
- [ ] Test all commands in production workspace
- [ ] Verify GitHub integration works
- [ ] Document runbook for common issues
- [ ] Train team on available commands

## Testing

### Unit Tests

Run the comprehensive test suite:

```bash
# All Slack app tests
npm run test src/slack

# Specific test files
npm run test src/slack/__tests__/app.test.ts
npm run test src/slack/__tests__/integration.test.ts
```

### Integration Testing

Test with mock Slack API:

```bash
# Run integration tests with nock mocking
npm run test:integration
```

### Manual Testing Scenarios

1. **Command Testing**
   ```
   /flakeguard help
   /flakeguard status microsoft/typescript  
   /flakeguard topflaky 5
   /flakeguard status nonexistent/repo
   ```

2. **Interactive Testing**
   - Click quarantine buttons
   - Click issue creation buttons  
   - Click view details buttons
   - Test error scenarios

3. **Rate Limiting**
   - Send multiple rapid commands
   - Verify rate limit messages
   - Test limit reset behavior

## Troubleshooting

### Common Development Issues

1. **ngrok tunnel disconnected**
   ```bash
   # Restart ngrok
   ngrok http 3001
   # Update Slack app URLs with new ngrok URL
   ```

2. **Bot not responding**
   ```bash
   # Check server logs
   tail -f logs/combined.log
   
   # Verify bot is running
   curl http://localhost:3001/slack/health
   ```

3. **Permission errors**
   - Verify bot is invited to channels
   - Check OAuth scopes in Slack app settings
   - Confirm app installation is complete

### Production Issues

1. **High latency responses**
   - Check database performance
   - Monitor GitHub API rate limits
   - Verify server resources

2. **Intermittent failures**
   - Check SSL certificate validity
   - Verify webhook URL accessibility
   - Monitor network connectivity

3. **Rate limiting issues**
   - Review usage patterns
   - Adjust rate limits if needed
   - Implement request queuing

## Support

For issues and questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review server logs for error details
3. Test with the health check endpoints
4. Verify Slack app configuration
5. Create an issue with reproduction steps

## Changelog

### v1.0.0
- Initial Slack integration
- Basic slash commands (`status`, `topflaky`, `help`)
- Interactive quarantine and issue creation
- Rate limiting and security features
- Comprehensive error handling
- Production deployment support