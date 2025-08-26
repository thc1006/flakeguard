#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';

import { version } from '../../package.json' with { type: 'json' };
import { FlakeGuardSetupWizard } from '../wizard/SetupWizard.js';

const program = new Command();

program
  .name('flakeguard-init')
  .description('FlakeGuard interactive setup wizard')
  .version(version);

program
  .option('-d, --dry-run', 'Run in dry-run mode without making changes')
  .option('-t, --transcript <file>', 'Save transcript log to file')
  .option('-l, --language <lang>', 'Set language (en|zh-TW)', 'en')
  .option('-c, --config <file>', 'Use configuration template file')
  .option('--skip-validation', 'Skip prerequisite validation')
  .option('--verbose', 'Enable verbose output')
  .action(async (options) => {
    try {
      console.log(
        chalk.blue.bold(
          '\n🛠️  FlakeGuard Setup Wizard\n' +
          '=====================================\n'
        )
      );

      const wizard = new FlakeGuardSetupWizard({
        dryRun: options.dryRun || false,
        transcriptFile: options.transcript,
        language: options.language as 'en' | 'zh-TW',
        configTemplate: options.config,
        skipValidation: options.skipValidation || false,
        verbose: options.verbose || false
      });

      await wizard.run();
      
      console.log(
        chalk.green.bold(
          '\n✅ Setup completed successfully!\n'
        )
      );
    } catch (error) {
      console.error(
        chalk.red.bold(
          '\n❌ Setup failed:\n'
        ),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program.parse();
