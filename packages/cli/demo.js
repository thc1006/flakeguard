#!/usr/bin/env node

// Demo script to showcase FlakeGuard Setup Wizard
const chalk = require('chalk');

console.log(chalk.cyan.bold('\n🚀 FlakeGuard Setup Wizard Demo'));
console.log(chalk.cyan('======================================\n'));

console.log(chalk.white('The FlakeGuard Setup Wizard provides:'));
console.log('');

const features = [
  '🌍 Bilingual support (English & Traditional Chinese)',
  '🔧 Interactive step-by-step configuration',
  '📊 System prerequisites validation',
  '💾 Database setup (PostgreSQL & Redis)',
  '🐱 GitHub App integration guide',
  '💬 Slack App setup assistance',
  '🔒 Secure .env file generation',
  '👨‍⚕️ Health checks and validation',
  '📝 Optional transcript logging',
  '🔍 Dry-run mode for testing'
];

features.forEach(feature => {
  console.log(chalk.green(`  ${feature}`));
});

console.log('');
console.log(chalk.blue.bold('Usage Examples:'));
console.log('');
console.log(chalk.yellow('# Basic setup'));
console.log(chalk.gray('pnpm flakeguard:init'));
console.log('');
console.log(chalk.yellow('# Dry-run mode (no changes made)'));
console.log(chalk.gray('pnpm flakeguard:init --dry-run'));
console.log('');
console.log(chalk.yellow('# Chinese language'));
console.log(chalk.gray('pnpm flakeguard:init --language zh-TW'));
console.log('');
console.log(chalk.yellow('# With transcript logging'));
console.log(chalk.gray('pnpm flakeguard:init --transcript setup.log'));
console.log('');
console.log(chalk.yellow('# Show help'));
console.log(chalk.gray('pnpm flakeguard:init --help'));

console.log('');
console.log(chalk.green.bold('✨ Ready to set up FlakeGuard!'));
console.log('');
