# FlakeGuard Setup Wizard - Demo Guide

This guide demonstrates the key features of the FlakeGuard Setup Wizard CLI.

## Quick Demo

### 1. Basic Help

```bash
$ pnpm flakeguard:init --help

Usage: flakeguard-init [options]

FlakeGuard interactive setup wizard

Options:
  -V, --version            output the version number
  -d, --dry-run            Run in dry-run mode without making changes
  -t, --transcript <file>  Save transcript log to file
  -l, --language <lang>    Set language (en|zh-TW) (default: "en")
  -c, --config <file>      Use configuration template file
  --skip-validation        Skip prerequisite validation
  --verbose                Enable verbose output
  -h, --help               display help for command
```

### 2. Demo Preview

```bash
$ node packages/cli/demo.js

🚀 FlakeGuard Setup Wizard Demo
======================================

The FlakeGuard Setup Wizard provides:

  🌍 Bilingual support (English & Traditional Chinese)
  🔧 Interactive step-by-step configuration
  📊 System prerequisites validation
  💾 Database setup (PostgreSQL & Redis)
  🐱 GitHub App integration guide
  💬 Slack App setup assistance
  🔒 Secure .env file generation
  👨‍⚕️ Health checks and validation
  📝 Optional transcript logging
  🔍 Dry-run mode for testing

Usage Examples:

# Basic setup
pnpm flakeguard:init

# Dry-run mode (no changes made)
pnpm flakeguard:init --dry-run

# Chinese language
pnpm flakeguard:init --language zh-TW

# With transcript logging
pnpm flakeguard:init --transcript setup.log

# Show help
pnpm flakeguard:init --help

✨ Ready to set up FlakeGuard!
```

## Interactive Setup Demo

When you run the wizard interactively, you'll see:

### Welcome Screen

```
🛠️  FlakeGuard Setup Wizard
=====================================

Welcome to FlakeGuard!
This interactive wizard will guide you through setting up FlakeGuard,
a comprehensive test flakiness detection and management system.

We'll help you configure:
  • Environment settings
  • Database connections
  • GitHub integration
  • Slack notifications
  • Security settings

? Ready to begin setup? (Y/n)
```

### Environment Configuration

```
Environment Configuration

? Select environment: (Use arrow keys)
❯ development 
  production 
  staging 
  test 

? API server port: (3000) 
? API server host: (0.0.0.0) 
? CORS allowed origin: (http://localhost:3000) 
```

### Database Setup Options

```
Database Setup

FlakeGuard requires PostgreSQL and Redis for data storage and caching.

? How would you like to set up databases? (Use arrow keys)
❯ Use Docker containers (recommended for development)
  Connect to existing database servers 
  Use cloud database services 
```

### GitHub Integration

```
GitHub Integration Setup

FlakeGuard integrates with GitHub to analyze test results from GitHub Actions 
and provide automated feedback on pull requests.

? Set up GitHub integration? (Y/n) 

? Do you already have a GitHub App for FlakeGuard? (y/N) 

GitHub App Creation Guide
=========================
1. Go to GitHub Settings > Developer settings > GitHub Apps
2. Click "New GitHub App"
3. Fill in the app details (name, description, homepage URL)
4. Set webhook URL to your FlakeGuard API endpoint
5. Configure permissions and events (see below)

Required Permissions:
  Repository permissions:
    - Actions: Read
    - Checks: Write
    - Contents: Read
    - Issues: Write
    - Metadata: Read
    - Pull requests: Write
    - Statuses: Write
  Organization permissions:
    - Members: Read

? Open GitHub App creation page in browser? (Y/n)
```

### Configuration Generation

```
Configuration Generation

⏳ Creating .env file...
✅ Configuration saved to /path/to/flakeguard/.env

💾 Existing configuration backed up to: .env.backup.2024-01-15T14-30-00-123Z
```

### Health Checks

```
System Health Check

⏳ Testing database connections...
✅ database: Database connection healthy (234ms)
✅ redis: Redis connection healthy (156ms)
❌ api: API service not running - Start the FlakeGuard API service
✅ system: System resources healthy - Memory: 45.2%, CPU: 12.3%, Cores: 8
```

### Completion

```
✅ Setup Complete!
==================

Congratulations! FlakeGuard has been successfully configured and is ready to use.

Next Steps:

1. Start the FlakeGuard services: pnpm run dev
2. Install the GitHub App in your repositories  
3. Configure CI pipelines to send test results
4. Access the dashboard at http://localhost:3000

📝 Setup transcript saved to: setup-2024-01-15T14-30-00.log
```

## Dry-Run Mode Demo

```bash
$ pnpm flakeguard:init --dry-run

🛠️  FlakeGuard Setup Wizard
=====================================

⚠️  Running in dry-run mode - no changes will be made

[... interactive setup ...]

Configuration Generation

📝 Configuration would be saved to: /path/to/flakeguard/.env

Configuration Preview (Dry Run)
==================================================
# FlakeGuard Configuration
# Generated on 2024-01-15T14:30:00.123Z
# DO NOT COMMIT THIS FILE TO VERSION CONTROL

# Database Configuration
DATABASE_URL=postgresql://postgres:****@localhost:5432/flakeguard?schema=public
REDIS_URL=redis://localhost:6379

# API Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Security Configuration
JWT_SECRET=a1b2****************************c9d0
API_KEY=x1y2****************z9w0

# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_CLIENT_ID=Iv1.****
GITHUB_CLIENT_SECRET=abc1****************************xyz9

# Feature Flags
ENABLE_GITHUB_WEBHOOKS=true
ENABLE_SLACK_APP=false
ENABLE_QUARANTINE_ACTIONS=true
==================================================
```

## Chinese Language Demo

```bash
$ pnpm flakeguard:init --language zh-TW

🛠️  FlakeGuard 設置精靈
=====================================

歡迎使用 FlakeGuard 設置精靈！

這個互動式精靈將引導您設置 FlakeGuard，
一個全面的測試不穩定性檢測和管理系統。

我們將幫助您配置：
  • 環境設置
  • 數據庫連接
  • GitHub 集成
  • Slack 通知
  • 安全設置

? 準備開始設置嗎？ (Y/n)
```

## Transcript Logging Demo

```bash
$ pnpm flakeguard:init --transcript setup-demo.log

[... setup process ...]

📝 Setup transcript saved to: setup-demo.log
```

**Generated transcript content:**

```
# FlakeGuard Setup Wizard Transcript
# Generated: 2024-01-15T14:30:00.123Z
# Node Version: v20.11.0
# Platform: win32
# Working Directory: C:\Users\user\flakeguard

Timeline:
=========

[1/15/2024, 2:30:00 PM] ℹ️  SETUP: Setup wizard started
  Data: {
    "dryRun": false,
    "language": "en",
    "verbose": false
  }

[1/15/2024, 2:30:15 PM] ✅ VALIDATION: Prerequisites validation completed
  Data: {
    "node": { "valid": true, "version": "20.11.0" },
    "packageManager": { "valid": true, "tool": "pnpm", "version": "8.15.1" },
    "docker": { "valid": true, "dockerVersion": "24.0.7", "composeVersion": "2.23.3" }
  }

[1/15/2024, 2:30:45 PM] ℹ️  ENVIRONMENT: Environment setup completed
  Data: {
    "nodeEnv": "development",
    "port": 3000,
    "host": "0.0.0.0"
  }

[1/15/2024, 2:32:10 PM] ℹ️  DATABASE: Database setup completed
  Data: {
    "type": "docker",
    "databaseUrl": "postgresql://postgres:****@localhost:5432/flakeguard?schema=public",
    "redisUrl": "redis://localhost:6379"
  }

[1/15/2024, 2:35:30 PM] ✅ HEALTH: Health checks completed
  Data: {
    "database": { "healthy": true, "responseTime": 234 },
    "redis": { "healthy": true, "responseTime": 156 },
    "api": { "healthy": false, "message": "API service not running" }
  }

[1/15/2024, 2:35:45 PM] ℹ️  SETUP: Setup wizard completed successfully

Summary:
========
Total Entries: 12
Errors: 0
Warnings: 1
Duration: 5.75 minutes
Stages: welcome, validation, environment, database, github, configuration, health, completion

Transcript completed: 2024-01-15T14:35:45.678Z
```

## File Structure After Setup

```
flakeguard/
├── .env                     # Generated configuration (600 permissions)
├── .env.backup.2024-...     # Backup of previous .env (if existed)
├── setup-demo.log          # Transcript log (if requested)
├── github-app-private.pem  # GitHub private key (if saved to file)
└── ...
```

## Testing the CLI

To test different aspects:

```bash
# Test help system
pnpm flakeguard:init --help

# Test dry-run mode (safe)
pnpm flakeguard:init --dry-run

# Test Chinese interface
pnpm flakeguard:init --language zh-TW --dry-run

# Test with logging
pnpm flakeguard:init --transcript test-run.log --dry-run

# Test verbose output
pnpm flakeguard:init --dry-run --verbose

# Test skipping validation
pnpm flakeguard:init --dry-run --skip-validation
```

## Common Use Cases

### Development Setup
```bash
# Quick development setup with logging
pnpm flakeguard:init --transcript dev-setup.log
```

### Production Setup
```bash
# Production setup with template
pnpm flakeguard:init --config production-template.json
```

### Testing Configuration
```bash
# Test configuration changes safely
pnpm flakeguard:init --dry-run --verbose
```

### Taiwanese Users
```bash
# Complete Chinese interface
pnpm flakeguard:init --language zh-TW
```

### CI/CD Integration
```bash
# Non-interactive setup with template
pnpm flakeguard:init --config ci-template.json --skip-validation
```

The FlakeGuard Setup Wizard provides a comprehensive, user-friendly way to configure FlakeGuard with support for multiple languages, advanced validation, and flexible deployment options.
