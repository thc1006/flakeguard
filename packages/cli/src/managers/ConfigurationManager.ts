import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import chalk from 'chalk';
import Cryptr from 'cryptr';

import { I18nManager } from '../i18n/I18nManager';

export class ConfigurationManager {
  private i18n: I18nManager;
  private dryRun: boolean;
  private cryptr: Cryptr;

  constructor(i18n: I18nManager, dryRun: boolean) {
    this.i18n = i18n;
    this.dryRun = dryRun;
    this.cryptr = new Cryptr('flakeguard-setup-encryption-key');
  }

  async generateConfig(config: Record<string, any>): Promise<string> {
    const envPath = path.join(process.cwd(), '.env');
    const envExamplePath = path.join(process.cwd(), '.env.example');
    
    // Backup existing .env if it exists
    if (!this.dryRun) {
      await this.backupExistingConfig(envPath);
    }

    // Generate security secrets
    const secrets = this.generateSecrets();
    
    // Merge configuration
    const finalConfig = {
      ...config,
      ...secrets,
      // Environment-specific defaults
      LOG_LEVEL: config.LOG_LEVEL || 'info',
      WORKER_CONCURRENCY: config.WORKER_CONCURRENCY || 5,
      WORKER_NAME: config.WORKER_NAME || 'flakeguard-worker',
      RATE_LIMIT_MAX: config.RATE_LIMIT_MAX || 100,
      RATE_LIMIT_WINDOW_MS: config.RATE_LIMIT_WINDOW_MS || 60000,
      FLAKE_WARN_THRESHOLD: config.FLAKE_WARN_THRESHOLD || 0.3,
      FLAKE_QUARANTINE_THRESHOLD: config.FLAKE_QUARANTINE_THRESHOLD || 0.6,
      ENABLE_GITHUB_WEBHOOKS: config.ENABLE_GITHUB_WEBHOOKS !== false,
      ENABLE_QUARANTINE_ACTIONS: config.ENABLE_QUARANTINE_ACTIONS !== false,
      SLACK_PROCESS_BEFORE_RESPONSE: config.SLACK_PROCESS_BEFORE_RESPONSE !== false
    };

    // Generate .env content
    const envContent = this.generateEnvContent(finalConfig);
    
    if (this.dryRun) {
      console.log('\n' + chalk.yellow(this.i18n.t('config.dryRunPreview')));
      console.log(chalk.gray('='.repeat(50)));
      console.log(this.maskSensitiveValues(envContent));
      console.log(chalk.gray('='.repeat(50)));
      return envPath;
    } else {
      // Write configuration file
      await fs.writeFile(envPath, envContent, { mode: 0o600 });
      
      // Validate file permissions
      const stats = await fs.stat(envPath);
      if ((stats.mode & parseInt('777', 8)) !== parseInt('600', 8)) {
        console.log(chalk.yellow(
          `\n⚠️  ${this.i18n.t('config.permissionWarning')}`
        ));
      }
      
      console.log(chalk.green(
        `\n✅ ${this.i18n.t('config.fileCreated')}: ${chalk.bold(envPath)}`
      ));
      
      return envPath;
    }
  }

  private generateSecrets(): Record<string, string> {
    return {
      JWT_SECRET: this.generateRandomString(64),
      API_KEY: this.generateRandomString(32),
      SESSION_SECRET: this.generateRandomString(64),
      ENCRYPTION_KEY: this.generateRandomString(32)
    };
  }

  private generateRandomString(length: number): string {
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .substring(0, length);
  }

  private generateEnvContent(config: Record<string, any>): string {
    const sections = [
      {
        title: 'Database Configuration',
        keys: ['DATABASE_URL', 'REDIS_URL']
      },
      {
        title: 'API Configuration', 
        keys: ['PORT', 'HOST', 'NODE_ENV', 'CORS_ORIGIN']
      },
      {
        title: 'Security Configuration',
        keys: ['JWT_SECRET', 'API_KEY', 'SESSION_SECRET', 'ENCRYPTION_KEY']
      },
      {
        title: 'Rate Limiting',
        keys: ['RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS']
      },
      {
        title: 'Worker Configuration',
        keys: ['WORKER_CONCURRENCY', 'WORKER_NAME']
      },
      {
        title: 'Logging',
        keys: ['LOG_LEVEL']
      },
      {
        title: 'GitHub App Configuration',
        keys: [
          'GITHUB_APP_ID',
          'GITHUB_PRIVATE_KEY',
          'GITHUB_PRIVATE_KEY_PATH', 
          'GITHUB_WEBHOOK_SECRET',
          'GITHUB_CLIENT_ID',
          'GITHUB_CLIENT_SECRET'
        ]
      },
      {
        title: 'Slack App Configuration',
        keys: [
          'SLACK_BOT_TOKEN',
          'SLACK_SIGNING_SECRET',
          'SLACK_APP_TOKEN',
          'SLACK_PORT',
          'SLACK_PROCESS_BEFORE_RESPONSE'
        ]
      },
      {
        title: 'Policy Defaults',
        keys: ['FLAKE_WARN_THRESHOLD', 'FLAKE_QUARANTINE_THRESHOLD']
      },
      {
        title: 'Feature Flags',
        keys: [
          'ENABLE_SLACK_APP',
          'ENABLE_GITHUB_WEBHOOKS',
          'ENABLE_QUARANTINE_ACTIONS'
        ]
      }
    ];

    let envContent = `# FlakeGuard Configuration\n`;
    envContent += `# Generated on ${new Date().toISOString()}\n`;
    envContent += `# DO NOT COMMIT THIS FILE TO VERSION CONTROL\n\n`;

    for (const section of sections) {
      envContent += `# ${section.title}\n`;
      
      for (const key of section.keys) {
        if (config[key] !== undefined && config[key] !== null) {
          const value = this.formatEnvValue(config[key]);
          envContent += `${key}=${value}\n`;
        }
      }
      
      envContent += '\n';
    }

    return envContent;
  }

  private formatEnvValue(value: any): string {
    if (typeof value === 'string') {
      // Quote values that contain spaces or special characters
      if (value.includes(' ') || value.includes('\n') || value.includes('"')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    
    return String(value);
  }

  private maskSensitiveValues(content: string): string {
    const sensitiveKeys = [
      'JWT_SECRET',
      'API_KEY',
      'SESSION_SECRET',
      'ENCRYPTION_KEY',
      'GITHUB_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'GITHUB_CLIENT_SECRET',
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET',
      'SLACK_APP_TOKEN',
      'DATABASE_URL',
      'REDIS_URL'
    ];

    let maskedContent = content;
    
    for (const key of sensitiveKeys) {
      const regex = new RegExp(`(${key}=)([^\n]+)`, 'g');
      maskedContent = maskedContent.replace(regex, (match, prefix, value) => {
        if (value.length <= 8) {
          return `${prefix}${'*'.repeat(value.length)}`;
        }
        return `${prefix}${value.substring(0, 4)}${'*'.repeat(value.length - 8)}${value.substring(value.length - 4)}`;
      });
    }
    
    return maskedContent;
  }

  private async backupExistingConfig(envPath: string): Promise<void> {
    try {
      await fs.access(envPath);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${envPath}.backup.${timestamp}`;
      
      await fs.copyFile(envPath, backupPath);
      
      console.log(chalk.blue(
        `💾 ${this.i18n.t('config.backupCreated')}: ${chalk.bold(backupPath)}`
      ));
    } catch (error) {
      // File doesn't exist, no need to backup
    }
  }

  async loadConfigTemplate(templatePath: string): Promise<Record<string, any>> {
    try {
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      if (templatePath.endsWith('.json')) {
        return JSON.parse(templateContent);
      } else if (templatePath.endsWith('.yml') || templatePath.endsWith('.yaml')) {
        const yaml = await import('yaml');
        return yaml.parse(templateContent);
      } else {
        throw new Error(this.i18n.t('config.unsupportedTemplateFormat'));
      }
    } catch (error) {
      throw new Error(
        this.i18n.t('config.templateLoadError', { 
          path: templatePath, 
          error: error instanceof Error ? error.message : String(error) 
        })
      );
    }
  }

  async validateConfiguration(config: Record<string, any>): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields validation
    const requiredFields = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'API_KEY'];
    
    for (const field of requiredFields) {
      if (!config[field]) {
        errors.push(this.i18n.t('config.validation.missingRequired', { field }));
      }
    }

    // URL format validation
    if (config.DATABASE_URL && !config.DATABASE_URL.startsWith('postgresql://')) {
      errors.push(this.i18n.t('config.validation.invalidDatabaseUrl'));
    }
    
    if (config.REDIS_URL && !config.REDIS_URL.startsWith('redis://')) {
      errors.push(this.i18n.t('config.validation.invalidRedisUrl'));
    }

    // Port validation
    if (config.PORT) {
      const port = parseInt(config.PORT);
      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(this.i18n.t('config.validation.invalidPort'));
      }
    }

    // Secret strength validation
    if (config.JWT_SECRET && config.JWT_SECRET.length < 32) {
      warnings.push(this.i18n.t('config.validation.weakJwtSecret'));
    }
    
    if (config.API_KEY && config.API_KEY.length < 16) {
      warnings.push(this.i18n.t('config.validation.weakApiKey'));
    }

    // GitHub configuration validation
    if (config.ENABLE_GITHUB_WEBHOOKS && !config.GITHUB_APP_ID) {
      errors.push(this.i18n.t('config.validation.missingGitHubConfig'));
    }

    // Slack configuration validation
    if (config.ENABLE_SLACK_APP && !config.SLACK_BOT_TOKEN) {
      errors.push(this.i18n.t('config.validation.missingSlackConfig'));
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async exportConfiguration(config: Record<string, any>, format: 'json' | 'yaml' = 'json'): Promise<string> {
    const exportPath = path.join(
      process.cwd(), 
      `flakeguard-config.${format}`
    );
    
    // Remove sensitive values for export
    const exportConfig = { ...config };
    const sensitiveKeys = [
      'JWT_SECRET',
      'API_KEY', 
      'GITHUB_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'GITHUB_CLIENT_SECRET',
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET',
      'SLACK_APP_TOKEN'
    ];
    
    for (const key of sensitiveKeys) {
      if (exportConfig[key]) {
        exportConfig[key] = '<REDACTED>';
      }
    }

    let content: string;
    
    if (format === 'json') {
      content = JSON.stringify(exportConfig, null, 2);
    } else {
      const yaml = await import('yaml');
      content = yaml.stringify(exportConfig);
    }

    if (!this.dryRun) {
      await fs.writeFile(exportPath, content, 'utf8');
    }

    return exportPath;
  }
}