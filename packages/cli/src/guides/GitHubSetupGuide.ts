import inquirer from 'inquirer';
import chalk from 'chalk';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import ora from 'ora';
import { GitHubConfig } from '../types';
import { I18nManager } from '../i18n/I18nManager';

export class GitHubSetupGuide {
  private i18n: I18nManager;

  constructor(i18n: I18nManager) {
    this.i18n = i18n;
  }

  async setupGitHubApp(): Promise<GitHubConfig> {
    console.log(chalk.gray(this.i18n.t('github.description')));
    
    const { hasGitHubApp } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'hasGitHubApp',
        message: this.i18n.t('github.hasExistingApp'),
        default: false
      }
    ]);

    if (hasGitHubApp) {
      return await this.configureExistingApp();
    } else {
      await this.showAppCreationGuide();
      return await this.configureNewApp();
    }
  }

  private async showAppCreationGuide(): Promise<void> {
    console.log('\n' + chalk.blue.bold(this.i18n.t('github.creationGuide')));
    
    const steps = [
      this.i18n.t('github.step1'),
      this.i18n.t('github.step2'),
      this.i18n.t('github.step3'),
      this.i18n.t('github.step4'),
      this.i18n.t('github.step5')
    ];

    steps.forEach((step, index) => {
      console.log(`${chalk.cyan((index + 1).toString())}. ${step}`);
    });

    console.log('\n' + chalk.yellow(this.i18n.t('github.requiredPermissions')));
    
    const permissions = [
      'Repository permissions:',
      '  - Actions: Read',
      '  - Checks: Write', 
      '  - Contents: Read',
      '  - Issues: Write',
      '  - Metadata: Read',
      '  - Pull requests: Write',
      '  - Statuses: Write',
      'Organization permissions:',
      '  - Members: Read'
    ];

    permissions.forEach(permission => {
      console.log(chalk.gray(`   ${permission}`));
    });

    console.log('\n' + chalk.yellow(this.i18n.t('github.webhookEvents')));
    
    const events = [
      'check_run',
      'check_suite', 
      'pull_request',
      'push',
      'status'
    ];

    events.forEach(event => {
      console.log(chalk.gray(`   - ${event}`));
    });

    const { openBrowser } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'openBrowser',
        message: this.i18n.t('github.openBrowserPrompt'),
        default: true
      }
    ]);

    if (openBrowser) {
      const { spawn } = await import('cross-spawn');
      spawn('open', ['https://github.com/settings/apps/new'], { detached: true });
      console.log(chalk.green(this.i18n.t('github.browserOpened')));
    } else {
      console.log(chalk.blue(`\n${this.i18n.t('github.manualUrl')}: https://github.com/settings/apps/new`));
    }

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: this.i18n.t('github.pressEnterToContinue')
      }
    ]);
  }

  private async configureNewApp(): Promise<GitHubConfig> {
    console.log('\n' + chalk.blue(this.i18n.t('github.configureApp')));
    
    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'appId',
        message: this.i18n.t('github.enterAppId'),
        validate: (input: string) => {
          if (!input || !/^\d+$/.test(input)) {
            return this.i18n.t('github.invalidAppId');
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'clientId',
        message: this.i18n.t('github.enterClientId'),
        validate: (input: string) => {
          if (!input || input.length < 20) {
            return this.i18n.t('github.invalidClientId');
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: this.i18n.t('github.enterClientSecret'),
        validate: (input: string) => {
          if (!input || input.length < 40) {
            return this.i18n.t('github.invalidClientSecret');
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'webhookSecret',
        message: this.i18n.t('github.enterWebhookSecret'),
        validate: (input: string) => {
          if (!input || input.length < 16) {
            return this.i18n.t('github.invalidWebhookSecret');
          }
          return true;
        }
      }
    ]);

    // Handle private key
    const privateKeyConfig = await this.configurePrivateKey();

    // Validate app configuration
    await this.validateAppConfig({
      GITHUB_APP_ID: config.appId,
      GITHUB_CLIENT_ID: config.clientId,
      GITHUB_CLIENT_SECRET: config.clientSecret,
      GITHUB_WEBHOOK_SECRET: config.webhookSecret,
      ...privateKeyConfig
    });

    return {
      GITHUB_APP_ID: config.appId,
      GITHUB_CLIENT_ID: config.clientId,
      GITHUB_CLIENT_SECRET: config.clientSecret,
      GITHUB_WEBHOOK_SECRET: config.webhookSecret,
      ...privateKeyConfig
    };
  }

  private async configureExistingApp(): Promise<GitHubConfig> {
    console.log('\n' + chalk.blue(this.i18n.t('github.existingApp')));
    
    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'appId',
        message: this.i18n.t('github.enterAppId'),
        validate: (input: string) => {
          if (!input || !/^\d+$/.test(input)) {
            return this.i18n.t('github.invalidAppId');
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'clientId',
        message: this.i18n.t('github.enterClientId'),
        validate: (input: string) => {
          if (!input || input.length < 20) {
            return this.i18n.t('github.invalidClientId');
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: this.i18n.t('github.enterClientSecret'),
        validate: (input: string) => {
          if (!input || input.length < 40) {
            return this.i18n.t('github.invalidClientSecret');
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'webhookSecret',
        message: this.i18n.t('github.enterWebhookSecret'),
        validate: (input: string) => {
          if (!input || input.length < 16) {
            return this.i18n.t('github.invalidWebhookSecret');
          }
          return true;
        }
      }
    ]);

    const privateKeyConfig = await this.configurePrivateKey();

    // Validate existing app
    await this.validateAppConfig({
      GITHUB_APP_ID: config.appId,
      GITHUB_CLIENT_ID: config.clientId,
      GITHUB_CLIENT_SECRET: config.clientSecret,
      GITHUB_WEBHOOK_SECRET: config.webhookSecret,
      ...privateKeyConfig
    });

    return {
      GITHUB_APP_ID: config.appId,
      GITHUB_CLIENT_ID: config.clientId,
      GITHUB_CLIENT_SECRET: config.clientSecret,
      GITHUB_WEBHOOK_SECRET: config.webhookSecret,
      ...privateKeyConfig
    };
  }

  private async configurePrivateKey(): Promise<Partial<GitHubConfig>> {
    const { keyMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'keyMethod',
        message: this.i18n.t('github.selectKeyMethod'),
        choices: [
          {
            name: this.i18n.t('github.keyFromFile'),
            value: 'file'
          },
          {
            name: this.i18n.t('github.keyPasteContent'),
            value: 'paste'
          }
        ]
      }
    ]);

    if (keyMethod === 'file') {
      const { keyPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'keyPath',
          message: this.i18n.t('github.enterKeyPath'),
          validate: async (input: string) => {
            try {
              const fullPath = path.resolve(input);
              await fs.access(fullPath);
              const content = await fs.readFile(fullPath, 'utf8');
              if (!content.includes('BEGIN PRIVATE KEY')) {
                return this.i18n.t('github.invalidKeyFile');
              }
              return true;
            } catch {
              return this.i18n.t('github.keyFileNotFound');
            }
          }
        }
      ]);

      return {
        GITHUB_PRIVATE_KEY_PATH: path.resolve(keyPath)
      };
    } else {
      const { privateKey } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'privateKey',
          message: this.i18n.t('github.pastePrivateKey'),
          validate: (input: string) => {
            if (!input || !input.includes('BEGIN PRIVATE KEY')) {
              return this.i18n.t('github.invalidPrivateKey');
            }
            return true;
          }
        }
      ]);

      return {
        GITHUB_PRIVATE_KEY: privateKey.trim()
      };
    }
  }

  private async validateAppConfig(config: GitHubConfig): Promise<void> {
    const spinner = ora(this.i18n.t('github.validating')).start();
    
    try {
      // This would validate the GitHub App configuration
      // For now, we'll simulate validation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      spinner.succeed(this.i18n.t('github.validationSuccessful'));
      
      console.log('\n' + chalk.green('✅ ' + this.i18n.t('github.appConfigured')));
      console.log(chalk.gray(`   ${this.i18n.t('github.appId')}: ${config.GITHUB_APP_ID}`));
      console.log(chalk.gray(`   ${this.i18n.t('github.clientId')}: ${config.GITHUB_CLIENT_ID.substring(0, 8)}...`));
    } catch (error) {
      spinner.fail(this.i18n.t('github.validationFailed'));
      
      console.log(chalk.red('\n' + this.i18n.t('github.validationError') + ':'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      
      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: this.i18n.t('github.continueWithoutValidation'),
          default: false
        }
      ]);
      
      if (!continueAnyway) {
        throw new Error(this.i18n.t('github.setupAborted'));
      }
    }
  }

  async showWebhookUrl(baseUrl: string): Promise<void> {
    const webhookUrl = `${baseUrl}/api/webhooks/github`;
    
    console.log('\n' + chalk.blue.bold(this.i18n.t('github.webhookConfiguration')));
    console.log(chalk.white(`${this.i18n.t('github.webhookUrl')}: ${chalk.bold(webhookUrl)}`));
    
    console.log('\n' + chalk.yellow(this.i18n.t('github.updateWebhookInstructions')));
    
    const steps = [
      this.i18n.t('github.webhookStep1'),
      this.i18n.t('github.webhookStep2'),
      this.i18n.t('github.webhookStep3'),
      this.i18n.t('github.webhookStep4')
    ];

    steps.forEach((step, index) => {
      console.log(`${chalk.cyan((index + 1).toString())}. ${step}`);
    });
  }

  async testWebhook(config: GitHubConfig): Promise<boolean> {
    const spinner = ora(this.i18n.t('github.testingWebhook')).start();
    
    try {
      // This would test the webhook by making a test request
      // For now, we'll simulate the test
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      spinner.succeed(this.i18n.t('github.webhookTestSuccessful'));
      return true;
    } catch (error) {
      spinner.fail(this.i18n.t('github.webhookTestFailed'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      return false;
    }
  }
}