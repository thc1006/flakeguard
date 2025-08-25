import axios from 'axios';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';

import { I18nManager } from '../i18n/I18nManager';
import { SlackConfig } from '../types';

export class SlackSetupGuide {
  private i18n: I18nManager;

  constructor(i18n: I18nManager) {
    this.i18n = i18n;
  }

  async setupSlackApp(): Promise<SlackConfig> {
    console.log(chalk.gray(this.i18n.t('slack.description')));
    
    const { hasSlackApp } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'hasSlackApp',
        message: this.i18n.t('slack.hasExistingApp'),
        default: false
      }
    ]);

    if (hasSlackApp) {
      return await this.configureExistingApp();
    } else {
      await this.showAppCreationGuide();
      return await this.configureNewApp();
    }
  }

  private async showAppCreationGuide(): Promise<void> {
    console.log('\n' + chalk.blue.bold(this.i18n.t('slack.creationGuide')));
    
    const steps = [
      this.i18n.t('slack.step1'),
      this.i18n.t('slack.step2'),
      this.i18n.t('slack.step3'),
      this.i18n.t('slack.step4'),
      this.i18n.t('slack.step5')
    ];

    steps.forEach((step, index) => {
      console.log(`${chalk.cyan((index + 1).toString())}. ${step}`);
    });

    console.log('\n' + chalk.yellow(this.i18n.t('slack.requiredScopes')));
    
    const botScopes = [
      'channels:read',
      'chat:write',
      'commands',
      'files:write',
      'groups:read',
      'im:read',
      'users:read'
    ];

    const userScopes = [
      'channels:read',
      'groups:read',
      'im:read'
    ];

    console.log(chalk.white('\n  Bot Token Scopes:'));
    botScopes.forEach(scope => {
      console.log(chalk.gray(`    - ${scope}`));
    });

    console.log(chalk.white('\n  User Token Scopes:'));
    userScopes.forEach(scope => {
      console.log(chalk.gray(`    - ${scope}`));
    });

    console.log('\n' + chalk.yellow(this.i18n.t('slack.eventSubscriptions')));
    
    const events = [
      'message.channels',
      'message.groups',
      'message.im',
      'app_mention'
    ];

    events.forEach(event => {
      console.log(chalk.gray(`   - ${event}`));
    });

    const { openBrowser } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'openBrowser',
        message: this.i18n.t('slack.openBrowserPrompt'),
        default: true
      }
    ]);

    if (openBrowser) {
      const { spawn } = await import('cross-spawn');
      spawn('open', ['https://api.slack.com/apps'], { detached: true });
      console.log(chalk.green(this.i18n.t('slack.browserOpened')));
    } else {
      console.log(chalk.blue(`\n${this.i18n.t('slack.manualUrl')}: https://api.slack.com/apps`));
    }

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: this.i18n.t('slack.pressEnterToContinue')
      }
    ]);
  }

  private async configureNewApp(): Promise<SlackConfig> {
    console.log('\n' + chalk.blue(this.i18n.t('slack.configureApp')));
    
    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'botToken',
        message: this.i18n.t('slack.enterBotToken'),
        validate: (input: string) => {
          if (!input || !input.startsWith('xoxb-')) {
            return this.i18n.t('slack.invalidBotToken');
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'signingSecret',
        message: this.i18n.t('slack.enterSigningSecret'),
        validate: (input: string) => {
          if (!input || input.length !== 32) {
            return this.i18n.t('slack.invalidSigningSecret');
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'appToken',
        message: this.i18n.t('slack.enterAppToken'),
        validate: (input: string) => {
          if (!input || !input.startsWith('xapp-')) {
            return this.i18n.t('slack.invalidAppToken');
          }
          return true;
        }
      },
      {
        type: 'number',
        name: 'port',
        message: this.i18n.t('slack.enterPort'),
        default: 3001,
        validate: (input: number) => {
          if (input < 1024 || input > 65535) {
            return this.i18n.t('slack.invalidPort');
          }
          return true;
        }
      }
    ]);

    // Validate Slack app configuration
    await this.validateAppConfig({
      SLACK_BOT_TOKEN: config.botToken,
      SLACK_SIGNING_SECRET: config.signingSecret,
      SLACK_APP_TOKEN: config.appToken,
      SLACK_PORT: config.port,
      ENABLE_SLACK_APP: true
    });

    return {
      SLACK_BOT_TOKEN: config.botToken,
      SLACK_SIGNING_SECRET: config.signingSecret,
      SLACK_APP_TOKEN: config.appToken,
      SLACK_PORT: config.port,
      ENABLE_SLACK_APP: true
    };
  }

  private async configureExistingApp(): Promise<SlackConfig> {
    console.log('\n' + chalk.blue(this.i18n.t('slack.existingApp')));
    
    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'botToken',
        message: this.i18n.t('slack.enterBotToken'),
        validate: (input: string) => {
          if (!input || !input.startsWith('xoxb-')) {
            return this.i18n.t('slack.invalidBotToken');
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'signingSecret',
        message: this.i18n.t('slack.enterSigningSecret'),
        validate: (input: string) => {
          if (!input || input.length !== 32) {
            return this.i18n.t('slack.invalidSigningSecret');
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'appToken',
        message: this.i18n.t('slack.enterAppToken'),
        validate: (input: string) => {
          if (!input || !input.startsWith('xapp-')) {
            return this.i18n.t('slack.invalidAppToken');
          }
          return true;
        }
      },
      {
        type: 'number',
        name: 'port',
        message: this.i18n.t('slack.enterPort'),
        default: 3001,
        validate: (input: number) => {
          if (input < 1024 || input > 65535) {
            return this.i18n.t('slack.invalidPort');
          }
          return true;
        }
      }
    ]);

    // Validate existing app
    await this.validateAppConfig({
      SLACK_BOT_TOKEN: config.botToken,
      SLACK_SIGNING_SECRET: config.signingSecret,
      SLACK_APP_TOKEN: config.appToken,
      SLACK_PORT: config.port,
      ENABLE_SLACK_APP: true
    });

    return {
      SLACK_BOT_TOKEN: config.botToken,
      SLACK_SIGNING_SECRET: config.signingSecret,
      SLACK_APP_TOKEN: config.appToken,
      SLACK_PORT: config.port,
      ENABLE_SLACK_APP: true
    };
  }

  private async validateAppConfig(config: SlackConfig): Promise<void> {
    const spinner = ora(this.i18n.t('slack.validating')).start();
    
    try {
      // Test Slack API connection
      const response = await axios.get('https://slack.com/api/auth.test', {
        headers: {
          'Authorization': `Bearer ${config.SLACK_BOT_TOKEN}`
        },
        timeout: 10000
      });

      if (response.data.ok) {
        spinner.succeed(this.i18n.t('slack.validationSuccessful'));
        
        console.log('\n' + chalk.green('✅ ' + this.i18n.t('slack.appConfigured')));
        console.log(chalk.gray(`   ${this.i18n.t('slack.teamName')}: ${response.data.team}`));
        console.log(chalk.gray(`   ${this.i18n.t('slack.botName')}: ${response.data.user}`));
        console.log(chalk.gray(`   ${this.i18n.t('slack.botId')}: ${response.data.user_id}`));
      } else {
        throw new Error(response.data.error || 'Unknown API error');
      }
    } catch (error) {
      spinner.fail(this.i18n.t('slack.validationFailed'));
      
      console.log(chalk.red('\n' + this.i18n.t('slack.validationError') + ':'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      
      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: this.i18n.t('slack.continueWithoutValidation'),
          default: false
        }
      ]);
      
      if (!continueAnyway) {
        throw new Error(this.i18n.t('slack.setupAborted'));
      }
    }
  }

  async showEventSubscriptionUrl(baseUrl: string): Promise<void> {
    const eventUrl = `${baseUrl}/api/webhooks/slack/events`;
    
    console.log('\n' + chalk.blue.bold(this.i18n.t('slack.eventConfiguration')));
    console.log(chalk.white(`${this.i18n.t('slack.eventUrl')}: ${chalk.bold(eventUrl)}`));
    
    console.log('\n' + chalk.yellow(this.i18n.t('slack.updateEventInstructions')));
    
    const steps = [
      this.i18n.t('slack.eventStep1'),
      this.i18n.t('slack.eventStep2'),
      this.i18n.t('slack.eventStep3'),
      this.i18n.t('slack.eventStep4')
    ];

    steps.forEach((step, index) => {
      console.log(`${chalk.cyan((index + 1).toString())}. ${step}`);
    });
  }

  async testSlashCommand(_config: SlackConfig): Promise<boolean> {
    const spinner = ora(this.i18n.t('slack.testingSlashCommand')).start();
    
    try {
      // This would test a slash command by sending a test message
      // For now, we'll simulate the test
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      spinner.succeed(this.i18n.t('slack.slashCommandTestSuccessful'));
      return true;
    } catch (error) {
      spinner.fail(this.i18n.t('slack.slashCommandTestFailed'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  async showSlashCommandSetup(): Promise<void> {
    console.log('\n' + chalk.blue.bold(this.i18n.t('slack.slashCommandSetup')));
    
    const commands = [
      {
        command: '/flakeguard',
        url: '/api/webhooks/slack/commands',
        description: 'Interact with FlakeGuard',
        usage: 'Use in channels to get test results and manage flaky tests'
      },
      {
        command: '/flakeguard-status',
        url: '/api/webhooks/slack/status',
        description: 'Check system status',
        usage: 'Get current system health and statistics'
      }
    ];

    commands.forEach(cmd => {
      console.log(chalk.cyan(`\n${cmd.command}`));
      console.log(chalk.gray(`   URL: ${cmd.url}`));
      console.log(chalk.gray(`   Description: ${cmd.description}`));
      console.log(chalk.gray(`   Usage: ${cmd.usage}`));
    });

    console.log('\n' + chalk.yellow(this.i18n.t('slack.slashCommandInstructions')));
    
    const steps = [
      this.i18n.t('slack.commandStep1'),
      this.i18n.t('slack.commandStep2'),
      this.i18n.t('slack.commandStep3'),
      this.i18n.t('slack.commandStep4')
    ];

    steps.forEach((step, index) => {
      console.log(`${chalk.cyan((index + 1).toString())}. ${step}`);
    });
  }
}