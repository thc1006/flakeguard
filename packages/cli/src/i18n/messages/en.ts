import { I18nMessages } from '../../types/index.js';

export const englishMessages: I18nMessages = {
  welcome: {
    title: 'Welcome to FlakeGuard Setup Wizard!',
    description: 'This interactive wizard will guide you through setting up FlakeGuard,\na comprehensive test flakiness detection and management system.\n\nWe\'ll help you configure:',
    confirmProceed: 'Ready to begin setup?'
  },

  common: {
    dryRunMode: 'Running in dry-run mode - no changes will be made',
    cancelled: 'Setup cancelled by user',
    yes: 'Yes',
    no: 'No',
    continue: 'Continue',
    skip: 'Skip',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    error: 'Error',
    warning: 'Warning',
    info: 'Info'
  },

  validation: {
    checking: 'Validating system prerequisites...',
    completed: 'Prerequisites validation completed',
    failed: 'Prerequisites validation failed',
    skipped: 'Validation skipped',
    results: 'Validation Results',
    criticalFailures: 'Critical validation failures detected',
    continueAnyway: 'Continue setup anyway? (not recommended)',
    aborted: 'Setup aborted due to validation failures',
    invalidPort: 'Port must be between 1024 and 65535',
    
    node: {
      valid: 'Node.js {{version}} - OK',
      invalid: 'Node.js {{current}} found, {{required}} required',
      error: 'Failed to check Node.js version',
      suggestion1: 'Install Node.js 20 or later from https://nodejs.org',
      suggestion2: 'Use a Node.js version manager like nvm'
    },
    
    packageManager: {
      pnpm: 'pnpm {{version}} - OK (recommended)',
      npm: 'npm {{version}} - OK',
      notFound: 'No suitable package manager found',
      error: 'Failed to check package manager',
      pnpmRecommended: 'Consider installing pnpm for better performance',
      installPnpm: 'Install pnpm: npm install -g pnpm',
      installNpm: 'Update npm: npm install -g npm@latest'
    },
    
    docker: {
      valid: 'Docker {{dockerVersion}} + Compose {{composeVersion}} - OK',
      missingCompose: 'Docker found but Docker Compose is missing',
      notFound: 'Docker not found or not running',
      error: 'Failed to check Docker',
      installDocker: 'Install Docker Desktop from https://docker.com',
      installCompose: 'Install Docker Compose plugin',
      startDocker: 'Start Docker Desktop service'
    },
    
    system: {
      gitOk: 'Git - OK',
      gitMissing: 'Git - Missing',
      httpClientOk: 'HTTP client (curl/wget) - OK',
      httpClientMissing: 'HTTP client (curl/wget) - Missing',
      allValid: 'All system dependencies available',
      someInvalid: 'Some system dependencies missing',
      error: 'Failed to check system dependencies'
    },
    
    ports: {
      allAvailable: 'All required ports available',
      someUnavailable: 'Ports {{ports}} are currently in use',
      changeConfig: 'Change port configuration in the setup',
      stopServices: 'Stop services using these ports'
    },
    
    permissions: {
      valid: 'File system permissions - OK',
      invalid: 'Insufficient file system permissions',
      checkOwnership: 'Check file/directory ownership and permissions',
      runAsAdmin: 'Try running as administrator/root'
    },
    
    network: {
      valid: 'Network connectivity - OK',
      issues: 'Network connectivity issues detected',
      error: 'Failed to test network connectivity',
      checkFirewall: 'Check firewall settings',
      checkProxy: 'Check proxy configuration'
    }
  },

  environment: {
    title: 'Environment Configuration',
    nodeEnv: 'Node environment (development/production/staging/test):',
    port: 'API server port:',
    host: 'API server host:',
    corsOrigin: 'CORS allowed origin:'
  },

  database: {
    title: 'Database Setup',
    description: 'FlakeGuard requires PostgreSQL and Redis for data storage and caching.',
    selectType: 'How would you like to set up databases?',
    useDocker: 'Use Docker containers (recommended for development)',
    useExisting: 'Connect to existing database servers',
    useCloud: 'Use cloud database services',
    
    dockerSetup: 'Docker Database Setup',
    startContainers: 'Start database containers now?',
    startingContainers: 'Starting database containers...',
    containersStarted: 'Database containers started successfully',
    containersFailed: 'Failed to start database containers',
    
    postgresHost: 'PostgreSQL host:',
    postgresPort: 'PostgreSQL port:',
    postgresDatabase: 'Database name:',
    postgresUsername: 'Username:',
    postgresPassword: 'Password:',
    
    redisHost: 'Redis host:',
    redisPort: 'Redis port:',
    redisPassword: 'Redis password (leave empty if none):',
    
    existingSetup: 'Existing Database Setup',
    postgresUrl: 'PostgreSQL connection URL:',
    redisUrl: 'Redis connection URL:',
    invalidPostgresUrl: 'Invalid PostgreSQL URL (must start with postgresql://)',
    invalidRedisUrl: 'Invalid Redis URL (must start with redis://)',
    
    cloudSetup: 'Cloud Database Setup',
    selectProvider: 'Select your cloud provider:',
    cloudInstructions: 'Please create {{provider}} databases and provide connection details.',
    cloudPostgresUrl: 'Cloud PostgreSQL URL:',
    cloudRedisUrl: 'Cloud Redis URL:',
    
    testingConnections: 'Testing database connections...',
    testingRedis: 'Testing Redis connection...',
    connectionsSuccessful: 'Database connections successful',
    connectionsFailed: 'Database connections failed',
    connectionError: 'Connection error',
    continueWithoutConnection: 'Continue without successful connection test?',
    setupAborted: 'Database setup aborted',
    
    creatingDatabase: 'Creating database tables...',
    databaseCreated: 'Database tables created successfully',
    databaseCreationFailed: 'Failed to create database tables',
    
    seedingAdmin: 'Creating admin user...',
    adminEmail: 'Admin user email:',
    adminName: 'Admin user full name:',
    adminPassword: 'Admin user password:',
    invalidEmail: 'Please enter a valid email address',
    passwordTooShort: 'Password must be at least 8 characters',
    adminUserCreated: 'Admin user created successfully',
    adminUserFailed: 'Failed to create admin user',
    adminCredentials: 'Admin Login Credentials',
    email: 'Email',
    password: 'Password'
  },

  github: {
    title: 'GitHub Integration Setup',
    description: 'FlakeGuard integrates with GitHub to analyze test results from GitHub Actions and provide automated feedback on pull requests.',
    confirmSetup: 'Set up GitHub integration?',
    skipped: 'GitHub integration skipped',
    
    hasExistingApp: 'Do you already have a GitHub App for FlakeGuard?',
    
    creationGuide: 'GitHub App Creation Guide',
    step1: 'Go to GitHub Settings > Developer settings > GitHub Apps',
    step2: 'Click "New GitHub App"',
    step3: 'Fill in the app details (name, description, homepage URL)',
    step4: 'Set webhook URL to your FlakeGuard API endpoint',
    step5: 'Configure permissions and events (see below)',
    
    requiredPermissions: 'Required Permissions:',
    webhookEvents: 'Required Webhook Events:',
    
    openBrowserPrompt: 'Open GitHub App creation page in browser?',
    browserOpened: 'Browser opened - please create your GitHub App',
    manualUrl: 'Manual URL',
    pressEnterToContinue: 'Press Enter when you have created the GitHub App...',
    
    configureApp: 'Configure GitHub App',
    existingApp: 'Configure Existing GitHub App',
    
    enterAppId: 'GitHub App ID:',
    enterClientId: 'GitHub App Client ID:',
    enterClientSecret: 'GitHub App Client Secret:',
    enterWebhookSecret: 'Webhook Secret:',
    
    invalidAppId: 'App ID must be a number',
    invalidClientId: 'Invalid Client ID format',
    invalidClientSecret: 'Invalid Client Secret format',
    invalidWebhookSecret: 'Webhook Secret must be at least 16 characters',
    
    selectKeyMethod: 'How would you like to provide the private key?',
    keyFromFile: 'Load from file',
    keyPasteContent: 'Paste content',
    
    enterKeyPath: 'Path to private key file (.pem):',
    pastePrivateKey: 'Paste the private key content:',
    
    invalidKeyFile: 'File does not contain a valid private key',
    keyFileNotFound: 'Private key file not found',
    invalidPrivateKey: 'Invalid private key format',
    
    validating: 'Validating GitHub App configuration...',
    validationSuccessful: 'GitHub App configuration validated',
    validationFailed: 'GitHub App validation failed',
    validationError: 'Validation error',
    continueWithoutValidation: 'Continue without validation?',
    setupAborted: 'GitHub setup aborted',
    
    appConfigured: 'GitHub App configured successfully',
    appId: 'App ID',
    clientId: 'Client ID',
    
    webhookConfiguration: 'Webhook Configuration',
    webhookUrl: 'Webhook URL',
    updateWebhookInstructions: 'Update your GitHub App webhook URL:',
    webhookStep1: 'Go to your GitHub App settings',
    webhookStep2: 'Update the webhook URL to the value above',
    webhookStep3: 'Ensure webhook secret matches your configuration',
    webhookStep4: 'Save the changes',
    
    testingWebhook: 'Testing webhook connectivity...',
    webhookTestSuccessful: 'Webhook test successful',
    webhookTestFailed: 'Webhook test failed'
  },

  slack: {
    title: 'Slack Integration Setup',
    description: 'FlakeGuard can send notifications and provide interactive commands through Slack.',
    confirmSetup: 'Set up Slack integration?',
    skipped: 'Slack integration skipped',
    
    hasExistingApp: 'Do you already have a Slack App for FlakeGuard?',
    
    creationGuide: 'Slack App Creation Guide',
    step1: 'Go to https://api.slack.com/apps',
    step2: 'Click "Create New App" > "From scratch"',
    step3: 'Enter app name and select workspace',
    step4: 'Configure OAuth scopes (see below)',
    step5: 'Install app to workspace and copy tokens',
    
    requiredScopes: 'Required OAuth Scopes:',
    eventSubscriptions: 'Event Subscriptions:',
    
    openBrowserPrompt: 'Open Slack App creation page in browser?',
    browserOpened: 'Browser opened - please create your Slack App',
    manualUrl: 'Manual URL',
    pressEnterToContinue: 'Press Enter when you have created the Slack App...',
    
    configureApp: 'Configure Slack App',
    existingApp: 'Configure Existing Slack App',
    
    enterBotToken: 'Bot User OAuth Token (xoxb-...):',
    enterSigningSecret: 'Signing Secret:',
    enterAppToken: 'App-Level Token (xapp-...):',
    enterPort: 'Slack service port:',
    
    invalidBotToken: 'Bot token must start with "xoxb-"',
    invalidSigningSecret: 'Signing secret must be 32 characters',
    invalidAppToken: 'App token must start with "xapp-"',
    invalidPort: 'Port must be between 1024 and 65535',
    
    validating: 'Validating Slack App configuration...',
    validationSuccessful: 'Slack App configuration validated',
    validationFailed: 'Slack App validation failed',
    validationError: 'Validation error',
    continueWithoutValidation: 'Continue without validation?',
    setupAborted: 'Slack setup aborted',
    
    appConfigured: 'Slack App configured successfully',
    teamName: 'Team',
    botName: 'Bot Name',
    botId: 'Bot ID',
    
    eventConfiguration: 'Event Subscription Configuration',
    eventUrl: 'Request URL',
    updateEventInstructions: 'Update your Slack App event subscriptions:',
    eventStep1: 'Go to your Slack App settings',
    eventStep2: 'Navigate to "Event Subscriptions"',
    eventStep3: 'Set Request URL to the value above',
    eventStep4: 'Subscribe to the required bot events',
    
    testingSlashCommand: 'Testing slash command...',
    slashCommandTestSuccessful: 'Slash command test successful',
    slashCommandTestFailed: 'Slash command test failed',
    
    slashCommandSetup: 'Slash Commands Setup',
    slashCommandInstructions: 'Configure these slash commands in your Slack App:',
    commandStep1: 'Go to "Slash Commands" in your app settings',
    commandStep2: 'Create each command with the URLs shown above',
    commandStep3: 'Set appropriate descriptions and usage hints',
    commandStep4: 'Save and reinstall the app if needed'
  },

  config: {
    title: 'Configuration Generation',
    saved: 'Configuration saved to',
    wouldBeSaved: 'Configuration would be saved to',
    dryRunPreview: 'Configuration Preview (Dry Run)',
    permissionWarning: 'Warning: Configuration file permissions are not secure',
    fileCreated: 'Configuration file created',
    backupCreated: 'Existing configuration backed up to',
    
    unsupportedTemplateFormat: 'Unsupported template format (use .json or .yml)',
    templateLoadError: 'Failed to load template from {{path}}: {{error}}',
    
    validation: {
      missingRequired: 'Missing required field: {{field}}',
      invalidDatabaseUrl: 'Invalid DATABASE_URL format',
      invalidRedisUrl: 'Invalid REDIS_URL format',
      invalidPort: 'Invalid PORT value',
      weakJwtSecret: 'JWT_SECRET should be at least 32 characters',
      weakApiKey: 'API_KEY should be at least 16 characters',
      missingGitHubConfig: 'GitHub webhooks enabled but GitHub configuration missing',
      missingSlackConfig: 'Slack app enabled but Slack configuration missing'
    }
  },

  health: {
    title: 'System Health Check',
    
    database: {
      healthy: 'Database connection healthy',
      unhealthy: 'Database connection failed'
    },
    
    redis: {
      healthy: 'Redis connection healthy',
      unhealthy: 'Redis connection failed'
    },
    
    api: {
      healthy: 'API endpoint responding',
      unhealthy: 'API endpoint not responding',
      notRunning: 'API service not running',
      startService: 'Start the FlakeGuard API service'
    },
    
    github: {
      healthy: 'GitHub integration healthy',
      unhealthy: 'GitHub integration issues detected'
    },
    
    slack: {
      healthy: 'Slack integration healthy',
      unhealthy: 'Slack integration issues detected'
    },
    
    system: {
      healthy: 'System resources healthy',
      unhealthy: 'System under stress',
      stressed: 'System resources under stress',
      error: 'Failed to check system resources'
    }
  },

  completion: {
    title: 'Setup Complete!',
    message: 'Congratulations! FlakeGuard has been successfully configured and is ready to use.',
    nextSteps: 'Next Steps:',
    step1: 'Start the FlakeGuard services: pnpm run dev',
    step2: 'Install the GitHub App in your repositories',
    step3: 'Configure CI pipelines to send test results',
    step4: 'Access the dashboard at http://localhost:3000',
    transcriptSaved: 'Setup transcript saved to'
  }
};