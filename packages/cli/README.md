# FlakeGuard Setup Wizard CLI

An interactive command-line interface for setting up FlakeGuard, a comprehensive test flakiness detection and management system.

## Features

- 🌍 **Bilingual Support**: English and Traditional Chinese (Taiwan)
- 🔧 **Interactive Setup**: Step-by-step wizard for complete configuration
- 📊 **Environment Validation**: Checks system prerequisites and dependencies
- 💾 **Database Setup**: PostgreSQL and Redis configuration with multiple options
- 🐱 **GitHub Integration**: Complete GitHub App setup and webhook configuration
- 💬 **Slack Integration**: Slack App setup with bot and slash commands
- 🔒 **Secure Configuration**: Automatic secret generation and secure .env file creation
- 👨‍⚕️ **Health Checks**: Post-setup system verification
- 📝 **Transcript Logging**: Optional setup process recording
- 🔍 **Dry-Run Mode**: Test configuration without making changes

## Quick Start

### Run the Setup Wizard

```bash
# From the FlakeGuard project root
pnpm flakeguard:init

# Or with options
pnpm flakeguard:init --dry-run --language zh-TW --transcript setup.log
```

### Command Line Options

- `-d, --dry-run`: Run without making changes (preview mode)
- `-t, --transcript <file>`: Save detailed setup log
- `-l, --language <lang>`: Set language (`en` or `zh-TW`)
- `-c, --config <file>`: Use configuration template file
- `--skip-validation`: Skip prerequisite validation
- `--verbose`: Enable verbose output
- `-h, --help`: Show help information
- `-V, --version`: Show version number

## Setup Process

The wizard guides you through these stages:

### 1. Welcome & Prerequisites Validation
- Node.js version check (>=20.0.0)
- Package manager verification (pnpm preferred)
- Docker availability check
- System dependencies validation
- Port availability verification
- Network connectivity test

### 2. Environment Configuration
- Node environment selection (development/production/staging/test)
- API server port and host configuration
- CORS origin settings
- Basic feature flags

### 3. Database Setup
**Three setup options:**
- **Docker Containers** (recommended for development)
- **Existing Database Servers** (connect to running instances)
- **Cloud Database Services** (AWS, GCP, Azure, etc.)

**Features:**
- Connection testing and validation
- Admin user creation
- Database initialization

### 4. GitHub Integration (Optional)
- GitHub App creation guidance with browser integration
- App ID, Client ID/Secret, and Webhook Secret configuration
- Private key handling (file or paste)
- Webhook URL setup instructions
- Configuration validation

### 5. Slack Integration (Optional)
- Slack App creation walkthrough
- Bot token and signing secret configuration
- OAuth scopes and permissions setup
- Event subscription configuration
- Slash commands setup guidance

### 6. Configuration Generation
- Secure .env file creation with proper permissions (600)
- Automatic secret generation (JWT, API keys, etc.)
- Configuration backup of existing files
- Template support for different environments

### 7. Health Checks
- Database connectivity verification
- Redis connection testing
- API endpoint health check
- GitHub/Slack integration validation
- System resource monitoring

### 8. Completion & Next Steps
- Setup summary and success confirmation
- Service startup instructions
- Dashboard access information
- Integration installation guidance

## Advanced Features

### Configuration Templates

Create reusable setup templates:

```json
{
  "name": "Production Template",
  "environment": "production",
  "config": {
    "NODE_ENV": "production",
    "PORT": 3000,
    "ENABLE_SLACK_APP": true,
    "LOG_LEVEL": "warn"
  }
}
```

```bash
pnpm flakeguard:init --config templates/production.json
```

### Transcript Logging

Capture detailed setup information for troubleshooting:

```bash
pnpm flakeguard:init --transcript setup-$(date +%Y%m%d-%H%M%S).log
```

Transcript includes:
- Timestamp for each step
- User inputs (sensitive data masked)
- Validation results
- Error messages and stack traces
- System information
- Setup duration and summary

### Bilingual Support

#### English (Default)
```bash
pnpm flakeguard:init --language en
```

#### Traditional Chinese (Taiwan)
```bash
pnpm flakeguard:init --language zh-TW
```

### Dry-Run Mode

Test the setup process without making changes:

```bash
pnpm flakeguard:init --dry-run
```

Dry-run features:
- Shows configuration preview
- Tests all validations
- Simulates database connections
- Previews file operations
- No actual files created or modified

## Database Setup Options

### Docker Containers (Development)
- Automatic container management
- Pre-configured PostgreSQL and Redis
- Development-optimized settings
- Easy cleanup and reset

### Existing Databases (Production/Staging)
- Connect to running PostgreSQL and Redis instances
- Connection string configuration
- Health check validation
- Production-ready settings

### Cloud Services (Scalable)
- Support for major cloud providers:
  - AWS RDS + ElastiCache
  - Google Cloud SQL + Memorystore
  - Azure Database + Cache
  - Railway, Supabase, Upstash, etc.
- SSL/TLS connection support
- Managed service optimization

## Security Features

- **Automatic Secret Generation**: Cryptographically secure random secrets
- **File Permissions**: .env files created with 600 permissions (owner read/write only)
- **Configuration Backup**: Existing configuration files backed up before changes
- **Sensitive Data Masking**: Passwords and tokens masked in logs and dry-run output
- **Validation**: Strong password requirements and secure defaults

## Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Check what's using the port
lsof -i :3000
# Or change the port in the wizard
```

**Database connection failed:**
- Verify database server is running
- Check connection parameters (host, port, credentials)
- Ensure network connectivity
- Verify firewall settings

**GitHub App validation failed:**
- Double-check App ID and Client ID
- Verify webhook secret matches
- Ensure private key format is correct
- Check GitHub App permissions

**Slack App validation failed:**
- Verify bot token starts with `xoxb-`
- Check signing secret length (32 characters)
- Ensure app token starts with `xapp-`
- Confirm OAuth scopes are configured

### Getting Help

1. **Run with verbose output:**
   ```bash
   pnpm flakeguard:init --verbose
   ```

2. **Enable transcript logging:**
   ```bash
   pnpm flakeguard:init --transcript debug.log
   ```

3. **Use dry-run mode to debug:**
   ```bash
   pnpm flakeguard:init --dry-run --verbose
   ```

## Development

### Building the CLI

```bash
cd packages/cli
pnpm install
pnpm build
```

### Running Tests

```bash
pnpm test
```

### Development Mode

```bash
pnpm dev
```

## Architecture

The CLI is built with a modular architecture:

```
src/
├── bin/
│   ├── cli.ts          # Main CLI entry point
│   └── cli.js          # JavaScript fallback
├── wizard/
│   └── SetupWizard.ts  # Main wizard orchestrator
├── validators/
│   └── EnvironmentValidator.ts
├── managers/
│   ├── DatabaseManager.ts
│   └── ConfigurationManager.ts
├── guides/
│   ├── GitHubSetupGuide.ts
│   └── SlackSetupGuide.ts
├── health/
│   └── HealthChecker.ts
├── i18n/
│   ├── I18nManager.ts
│   └── messages/
│       ├── en.ts
│       └── zh-TW.ts
└── utils/
    └── TranscriptLogger.ts
```

## Contributing

When adding new features:

1. **Add both English and Chinese translations** in `src/i18n/messages/`
2. **Include comprehensive validation** with helpful error messages
3. **Support dry-run mode** for all operations
4. **Add transcript logging** for troubleshooting
5. **Follow the existing patterns** for consistency
6. **Test with different configurations** and edge cases

## License

See the main FlakeGuard LICENSE file.
