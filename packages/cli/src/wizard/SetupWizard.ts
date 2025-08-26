// import { promises as fs } from 'fs';
// import path from 'path';

import chalk from 'chalk';
import inquirer from 'inquirer';
// import { Listr } from 'listr2';
import ora from 'ora';

import { GitHubSetupGuide } from '../guides/GitHubSetupGuide.js';
import { SlackSetupGuide } from '../guides/SlackSetupGuide.js';
import { HealthChecker } from '../health/HealthChecker.js';
import { I18nManager } from '../i18n/I18nManager.js';
import { ConfigurationManager } from '../managers/ConfigurationManager.js';
import { DatabaseManager } from '../managers/DatabaseManager.js';
import { WizardOptions, SetupState } from '../types/index.js';
import { TranscriptLogger } from '../utils/TranscriptLogger.js';
import { EnvironmentValidator } from '../validators/EnvironmentValidator.js';

export class FlakeGuardSetupWizard {
  private readonly options: WizardOptions;
  private readonly state: SetupState;
  private readonly logger: TranscriptLogger;
  private readonly i18n: I18nManager;
  private readonly environmentValidator: EnvironmentValidator;
  private readonly databaseManager: DatabaseManager;
  private readonly gitHubGuide: GitHubSetupGuide;
  private readonly slackGuide: SlackSetupGuide;
  private readonly configManager: ConfigurationManager;
  private readonly healthChecker: HealthChecker;

  constructor(options: WizardOptions) {
    this.options = options;
    this.state = {
      currentStage: 'welcome',
      completed: [],
      config: {},
      validations: {}
    };
    
    this.logger = new TranscriptLogger(options.transcriptFile);
    this.i18n = new I18nManager(options.language);
    this.environmentValidator = new EnvironmentValidator(this.i18n);
    this.databaseManager = new DatabaseManager(this.i18n);
    this.gitHubGuide = new GitHubSetupGuide(this.i18n);
    this.slackGuide = new SlackSetupGuide(this.i18n);
    this.configManager = new ConfigurationManager(this.i18n, options.dryRun);
    this.healthChecker = new HealthChecker(this.i18n);
  }

  async run(): Promise<void> {
    await this.logger.init();
    await this.logger.log('Setup wizard started', this.options);

    try {
      await this.showWelcome();
      await this.validatePrerequisites();
      await this.setupEnvironment();
      await this.setupDatabase();
      await this.setupGitHubIntegration();
      await this.setupSlackIntegration();
      await this.generateConfiguration();
      await this.performHealthChecks();
      await this.showCompletion();
    } catch (error) {
      await this.logger.error('Setup failed', error);
      throw error;
    } finally {
      await this.logger.close();
    }
  }

  private async showWelcome(): Promise<void> {
    this.state.currentStage = 'welcome';
    
    const banner = chalk.cyan(
      '██████╗ ██╗      ██████╗ ██╗  ██╗███████╗ ██████╗ ██╗   ██╗ ██████╗ ██████╗ ██████╗\n' +
      '██╔══██╗██║     ██╔══██╗╚██╗██╔╝██╔════╝██╔══██╗██║   ██║██╔══██╗██╔══██╗██╔══██╗\n' +
      '██████╔╝██║     ██████╔╝ ╚███╔╝ █████╗  ██╔════╝██║   ██║██████╔╝██████╔╝██████╔╝\n' +
      '██╔══██╗██║     ██╔══██╗  ╚██╔╝  ██╔══╝  ██║████╗██║   ██║██╔══██╗██╔════╝██╔══██╗\n' +
      '██║  ██║███████╗██║  ██║   ██║   ███████╗╚██████╔╝╚██████╔╝██║  ██║███████╗██║  ██║\n' +
      '╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝   ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝'
    );

    console.log('\n' + banner + '\n');
    
    console.log(chalk.white(this.i18n.t('welcome.title')));
    console.log(chalk.gray(this.i18n.t('welcome.description')));
    
    if (this.options.dryRun) {
      console.log(chalk.yellow('\n⚠️  ' + this.i18n.t('common.dryRunMode')));
    }

    const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
      {
        type: 'confirm' as const,
        name: 'proceed',
        message: this.i18n.t('welcome.confirmProceed'),
        default: true
      }
    ]);

    if (!proceed) {
      console.log(chalk.yellow(this.i18n.t('common.cancelled')));
      process.exit(0);
    }

    await this.logger.log('Welcome stage completed');
  }

  private async validatePrerequisites(): Promise<void> {
    if (this.options.skipValidation) {
      console.log(chalk.yellow('\n⚠️  ' + this.i18n.t('validation.skipped')));
      return;
    }

    this.state.currentStage = 'validation';
    
    const spinner = ora(this.i18n.t('validation.checking')).start();
    
    try {
      const validationResults = await this.environmentValidator.validateAll();
      this.state.validations = validationResults;

      spinner.succeed(this.i18n.t('validation.completed'));
      
      // Show validation results
      console.log('\n' + chalk.bold(this.i18n.t('validation.results')) + '\n');
      
      for (const [category, result] of Object.entries(validationResults)) {
        const icon = result.valid ? '✅' : '❌';
        const color = result.valid ? chalk.green : chalk.red;
        
        console.log(`${icon} ${color(category)}: ${result.message}`);
        
        if (!result.valid && result.suggestions) {
          result.suggestions.forEach(suggestion => {
            console.log(`   ${chalk.yellow('→')} ${suggestion}`);
          });
        }
      }

      // Check if any critical validations failed
      const criticalFailures = Object.entries(validationResults)
        .filter(([, result]) => !result.valid && result.critical)
        .map(([category]) => category);

      if (criticalFailures.length > 0) {
        console.log(
          chalk.red.bold(
            '\n❌ ' + this.i18n.t('validation.criticalFailures')
          )
        );
        
        const { continueAnyway } = await inquirer.prompt<{ continueAnyway: boolean }>([
          {
            type: 'confirm' as const,
            name: 'continueAnyway',
            message: this.i18n.t('validation.continueAnyway'),
            default: false
          }
        ]);

        if (!continueAnyway) {
          throw new Error(this.i18n.t('validation.aborted'));
        }
      }

    } catch (error) {
      spinner.fail(this.i18n.t('validation.failed'));
      throw error;
    }

    await this.logger.log('Validation stage completed', this.state.validations);
  }

  private async setupEnvironment(): Promise<void> {
    this.state.currentStage = 'environment';
    
    console.log('\n' + chalk.bold(this.i18n.t('environment.title')) + '\n');
    
    const envQuestions = [
      {
        type: 'list' as const,
        name: 'nodeEnv',
        message: this.i18n.t('environment.nodeEnv'),
        default: 'development',
        choices: ['development', 'production', 'staging', 'test']
      },
      {
        type: 'number' as const,
        name: 'port',
        message: this.i18n.t('environment.port'),
        default: 3000,
        validate: (input: number) => {
          if (input < 1024 || input > 65535) {
            return this.i18n.t('validation.invalidPort');
          }
          return true;
        }
      },
      {
        type: 'input' as const,
        name: 'host',
        message: this.i18n.t('environment.host'),
        default: '0.0.0.0'
      },
      {
        type: 'input' as const,
        name: 'corsOrigin',
        message: this.i18n.t('environment.corsOrigin'),
        default: 'http://localhost:3000'
      }
    ];

    const envAnswers = await inquirer.prompt<{
      nodeEnv: string;
      port: number;
      host: string;
      corsOrigin: string;
    }>(envQuestions);
    this.state.config = { ...this.state.config, ...envAnswers };

    await this.logger.log('Environment setup completed', envAnswers);
  }

  private async setupDatabase(): Promise<void> {
    this.state.currentStage = 'database';
    
    console.log('\n' + chalk.bold(this.i18n.t('database.title')) + '\n');
    
    const dbConfig = await this.databaseManager.setupDatabase();
    this.state.config = { ...this.state.config, ...dbConfig };
    
    await this.logger.log('Database setup completed', dbConfig);
  }

  private async setupGitHubIntegration(): Promise<void> {
    this.state.currentStage = 'github';
    
    console.log('\n' + chalk.bold(this.i18n.t('github.title')) + '\n');
    
    const { setupGitHub } = await inquirer.prompt<{ setupGitHub: boolean }>([
      {
        type: 'confirm' as const,
        name: 'setupGitHub',
        message: this.i18n.t('github.confirmSetup'),
        default: true
      }
    ]);

    if (setupGitHub) {
      const githubConfig = await this.gitHubGuide.setupGitHubApp();
      this.state.config = { ...this.state.config, ...githubConfig };
      await this.logger.log('GitHub setup completed', githubConfig);
    } else {
      console.log(chalk.yellow(this.i18n.t('github.skipped')));
    }
  }

  private async setupSlackIntegration(): Promise<void> {
    this.state.currentStage = 'slack';
    
    console.log('\n' + chalk.bold(this.i18n.t('slack.title')) + '\n');
    
    const { setupSlack } = await inquirer.prompt<{ setupSlack: boolean }>([
      {
        type: 'confirm' as const,
        name: 'setupSlack',
        message: this.i18n.t('slack.confirmSetup'),
        default: false
      }
    ]);

    if (setupSlack) {
      const slackConfig = await this.slackGuide.setupSlackApp();
      this.state.config = { ...this.state.config, ...slackConfig };
      await this.logger.log('Slack setup completed', slackConfig);
    } else {
      console.log(chalk.yellow(this.i18n.t('slack.skipped')));
    }
  }

  private async generateConfiguration(): Promise<void> {
    this.state.currentStage = 'configuration';
    
    console.log('\n' + chalk.bold(this.i18n.t('config.title')) + '\n');
    
    const configPath = await this.configManager.generateConfig(this.state.config);
    
    if (!this.options.dryRun) {
      console.log(
        chalk.green(
          `✅ ${this.i18n.t('config.saved')}: ${chalk.bold(configPath)}`
        )
      );
    } else {
      console.log(
        chalk.yellow(
          `📝 ${this.i18n.t('config.wouldBeSaved')}: ${chalk.bold(configPath)}`
        )
      );
    }

    await this.logger.log('Configuration generated', { configPath, config: this.state.config });
  }

  private async performHealthChecks(): Promise<void> {
    this.state.currentStage = 'healthcheck';
    
    console.log('\n' + chalk.bold(this.i18n.t('health.title')) + '\n');
    
    const healthResults = await this.healthChecker.runHealthChecks(this.state.config);
    
    for (const [service, result] of Object.entries(healthResults)) {
      const icon = result.healthy ? '✅' : '❌';
      const color = result.healthy ? chalk.green : chalk.red;
      
      console.log(`${icon} ${color(service)}: ${result.message}`);
      
      if (!result.healthy && result.details) {
        console.log(`   ${chalk.gray(result.details)}`);
      }
    }

    await this.logger.log('Health checks completed', healthResults);
  }

  private async showCompletion(): Promise<void> {
    this.state.currentStage = 'completion';
    
    console.log('\n' + chalk.green.bold(this.i18n.t('completion.title')) + '\n');
    console.log(chalk.white(this.i18n.t('completion.message')));
    
    console.log('\n' + chalk.bold(this.i18n.t('completion.nextSteps')) + '\n');
    
    const nextSteps = [
      this.i18n.t('completion.step1'),
      this.i18n.t('completion.step2'),
      this.i18n.t('completion.step3'),
      this.i18n.t('completion.step4')
    ];

    nextSteps.forEach((step, index) => {
      console.log(`${chalk.cyan((index + 1).toString())}. ${step}`);
    });

    if (this.options.transcriptFile) {
      console.log(
        '\n' + 
        chalk.blue(
          `📝 ${this.i18n.t('completion.transcriptSaved')}: ${this.options.transcriptFile}`
        )
      );
    }

    await this.logger.log('Setup wizard completed successfully');
  }
}