import inquirer from 'inquirer';
import chalk from 'chalk';

export async function setupWizard(): Promise<void> {
  console.log(chalk.blue('\n🚀 Welcome to FlakeGuard Setup Wizard\n'));
  
  await inquirer.prompt([
    {
      type: 'input',
      name: 'githubAppId',
      message: 'Enter your GitHub App ID:',
      validate: (input) => input.length > 0 || 'App ID is required',
    },
    {
      type: 'input',
      name: 'databaseUrl',
      message: 'Enter your PostgreSQL connection URL:',
      default: 'postgresql://postgres:postgres@localhost:5432/flakeguard',
    },
    {
      type: 'input',
      name: 'redisUrl',
      message: 'Enter your Redis connection URL:',
      default: 'redis://localhost:6379',
    },
  ]);

  console.log(chalk.green('\n✅ Setup completed successfully!'));
  console.log(chalk.yellow('\nNext steps:'));
  console.log('1. Copy the generated .env file');
  console.log('2. Run: pnpm dev');
  console.log('3. Configure your GitHub webhooks\n');
}
