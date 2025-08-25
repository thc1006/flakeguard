# Quick Start

Get FlakeGuard up and running in under 10 minutes with Docker Compose.

## Prerequisites

Before you begin, ensure you have:

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) 8+
- A GitHub account and repository with Actions enabled

## Step 1: Clone and Setup

```bash
git clone https://github.com/flakeguard/flakeguard.git
cd flakeguard

# Copy environment files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
```

## Step 2: Generate Secrets

Generate secure secrets for your installation:

```bash
# Generate JWT secret (32 characters)
JWT_SECRET=$(openssl rand -base64 32)

# Generate API key (16 characters)
API_KEY=$(openssl rand -base64 16)

# Generate webhook secret (32 characters)
WEBHOOK_SECRET=$(openssl rand -base64 32)

echo "JWT_SECRET=$JWT_SECRET"
echo "API_KEY=$API_KEY"
echo "GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET"
```

## Step 3: Update Environment Files

Update your `.env` files with the generated secrets:

```bash title="apps/api/.env"
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flakeguard"
REDIS_URL="redis://localhost:6379"

# Application
NODE_ENV="development"
PORT=3000
LOG_LEVEL="info"

# Security
JWT_SECRET="your-generated-jwt-secret"
API_KEY="your-generated-api-key"

# GitHub (will be configured in Step 5)
GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_WEBHOOK_SECRET="your-generated-webhook-secret"
```

```bash title="apps/worker/.env"
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/flakeguard"
REDIS_URL="redis://localhost:6379"

# Application
NODE_ENV="development"
LOG_LEVEL="info"
```

## Step 4: Start Services

Start the infrastructure services:

```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Install dependencies
pnpm install

# Setup database
pnpm migrate:dev

# Start development servers
pnpm dev
```

## Step 5: Verify Installation

Check that all services are running:

```bash
# API Health Check
curl http://localhost:3000/health

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2024-01-01T00:00:00.000Z",
#   "uptime": 1.234,
#   "environment": "development",
#   "version": "1.0.0"
# }
```

Access the services:

- **API Documentation**: http://localhost:3000/documentation
- **Database GUI**: http://localhost:5050 (pgAdmin)
  - Email: `admin@flakeguard.dev`
  - Password: `admin`

## Step 6: Create GitHub App

FlakeGuard requires a GitHub App to access your repositories and process webhooks.

### Create the App

1. Go to [GitHub Settings > Developer settings > GitHub Apps](https://github.com/settings/apps)
2. Click **"New GitHub App"**
3. Fill in the required fields:

```yaml
App name: "FlakeGuard-YourOrg" # Must be unique
Homepage URL: "http://localhost:3000"
Webhook URL: "https://your-ngrok-url.com/api/github/webhook"
Webhook secret: "your-generated-webhook-secret"
```

### Configure Permissions

Set these repository permissions:

| Permission | Access |
|------------|--------|
| Actions | Read |
| Checks | Write |
| Contents | Read |
| Issues | Write |
| Metadata | Read |
| Pull requests | Write |

### Subscribe to Events

Enable these webhook events:
- Check run
- Check suite  
- Pull request
- Push
- Workflow job
- Workflow run

### Generate Private Key

1. In your GitHub App settings, scroll to "Private keys"
2. Click **"Generate a private key"**
3. Download the `.pem` file
4. Convert it to a single-line string:

```bash
# Convert PEM to single line
cat your-app-name.2024-01-01.private-key.pem | tr '\n' '|' | sed 's/|/\\n/g'
```

### Update Environment

Add the GitHub App configuration to `apps/api/.env`:

```bash
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET="your-generated-webhook-secret"
```

## Step 7: Expose Local Server

For GitHub webhooks to reach your local development server, you need a public URL:

### Option 1: ngrok (Recommended)

```bash
# Install ngrok
npm install -g ngrok

# Expose port 3000
ngrok http 3000

# Update your GitHub App webhook URL to the ngrok URL
# Example: https://abc123.ngrok.io/api/github/webhook
```

### Option 2: Cloudflare Tunnel

```bash
# Install cloudflared
# Follow instructions at https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Create tunnel
cloudflared tunnel --url http://localhost:3000
```

## Step 8: Install GitHub App

1. In your GitHub App settings, click **"Install App"**
2. Choose the repositories you want to monitor
3. Complete the installation

## Step 9: Test Integration

Create a simple workflow in your repository to test the integration:

```yaml title=".github/workflows/test-flakeguard.yml"
name: Test FlakeGuard
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Tests
        run: |
          # Create a dummy JUnit XML file for testing
          mkdir -p test-results
          cat > test-results/junit.xml << 'EOF'
          <?xml version="1.0" encoding="UTF-8"?>
          <testsuites name="test" tests="3" failures="1" time="1.234">
            <testsuite name="ExampleTest" tests="3" failures="1" time="1.234">
              <testcase name="test_passes" classname="ExampleTest" time="0.123"/>
              <testcase name="test_fails" classname="ExampleTest" time="0.456">
                <failure message="Assertion failed">Expected true but got false</failure>
              </testcase>
              <testcase name="test_passes_again" classname="ExampleTest" time="0.789"/>
            </testsuite>
          </testsuites>
          EOF
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results/junit.xml
```

## Step 10: Verify Everything Works

1. Commit and push the workflow to your repository
2. Check the FlakeGuard logs:

```bash
# In your FlakeGuard terminal
# You should see webhook processing logs
```

3. Look for a Check Run on your commit with FlakeGuard results

## Next Steps

Congratulations! FlakeGuard is now running and processing your test results. Here's what to do next:

### Learn More
- [Core Concepts](../concepts/flaky-tests.md) - Understand how FlakeGuard works
- [Configuration](./configuration.md) - Customize policies and behavior
- [GitHub Actions Integration](../integrations/github-actions.md) - Advanced workflow setup

### Production Deployment
- [Installation Guide](./installation.md) - Production deployment options
- [Security Best Practices](../security/best-practices.md) - Secure your deployment
- [Monitoring & Observability](../monitoring/slos-dora.md) - Set up monitoring

### Troubleshooting
Having issues? Check our [troubleshooting guide](../troubleshooting/common-issues.md) or [create an issue](https://github.com/flakeguard/flakeguard/issues).

## What's Happening?

With FlakeGuard running, here's what happens when you push code:

1. **GitHub triggers your workflow** - Your tests run and generate JUnit XML
2. **Webhook sent to FlakeGuard** - GitHub notifies FlakeGuard about the workflow completion
3. **Artifact processing** - FlakeGuard downloads and analyzes your test results
4. **Flakiness analysis** - Algorithms identify patterns and calculate flakiness scores
5. **Report generation** - A detailed report with recommendations is created
6. **Check run creation** - Results appear as a Check Run on your commit
7. **Historical tracking** - Data is stored for trend analysis and future comparisons

Start pushing some test changes and watch FlakeGuard identify flaky patterns in your test suite!