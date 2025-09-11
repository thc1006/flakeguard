#!/usr/bin/env tsx

/**
 * FlakeGuard PR Notifier
 * 
 * Posts consolidated PR comments summarizing new quarantines with owner mentions
 * based on CODEOWNERS mapping. Uses GitHub REST API for comment posting.
 */

import { program } from 'commander';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { QuarantineValidator } from './quarantine-validator.js';

// =============================================================================
// Types
// =============================================================================

interface CodeownersRule {
  pattern: string;
  owners: string[];
  line: number;
}

interface QuarantineChange {
  type: 'added' | 'removed' | 'modified';
  testKey: string;
  reason?: string;
  ownerTeam?: string;
  ttlDays?: number;
  priority?: string;
  jiraTicket?: string;
  filePath: string;
  codeowners?: string[];
}

// Removed unused interface PRComment

interface GitHubAPIResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// =============================================================================
// CODEOWNERS Parser
// =============================================================================

class CodeownersParser {
  private rules: CodeownersRule[] = [];

  async loadCodeowners(repoPath: string): Promise<void> {
    const possiblePaths = [
      `${repoPath}/.github/CODEOWNERS`,
      `${repoPath}/CODEOWNERS`,
      `${repoPath}/docs/CODEOWNERS`,
    ];

    let codeownersContent = '';
    for (const path of possiblePaths) {
      try {
        codeownersContent = await fs.readFile(path, 'utf-8');
        console.log(chalk.gray(`📋 Loaded CODEOWNERS from ${path}`));
        break;
      } catch {
        // Try next path
      }
    }

    if (!codeownersContent) {
      console.log(chalk.yellow('⚠️  No CODEOWNERS file found'));
      return;
    }

    this.parseCodeowners(codeownersContent);
  }

  private parseCodeowners(content: string): void {
    const lines = content.split('\n');
    this.rules = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      // Parse pattern and owners
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) {
        return;
      }

      const pattern = parts[0];
      if (!pattern) return;
      
      const owners = parts.slice(1).map(owner => {
        // Remove @ prefix if present
        return owner.startsWith('@') ? owner.slice(1) : owner;
      });

      this.rules.push({
        pattern,
        owners,
        line: index + 1,
      });
    });

    console.log(chalk.gray(`📊 Parsed ${this.rules.length} CODEOWNERS rules`));
  }

  /**
   * Find owners for a given file path using CODEOWNERS rules
   * Last matching pattern wins (GitHub behavior)
   */
  findOwners(filePath: string): string[] {
    let matchingOwners: string[] = [];

    for (const rule of this.rules) {
      if (this.matchesPattern(rule.pattern, filePath)) {
        matchingOwners = rule.owners;
      }
    }

    return matchingOwners;
  }

  private matchesPattern(pattern: string, filePath: string): boolean {
    // Convert glob pattern to regex
    // Simplified implementation - in production, use a proper glob library
    
    // Handle directory patterns
    if (pattern.endsWith('/')) {
      return filePath.startsWith(pattern) || filePath.startsWith(pattern.slice(0, -1) + '/');
    }

    // Handle wildcard patterns
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '[^/]*')
        .replace(/\*\*/g, '.*');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(filePath);
    }

    // Exact match
    return filePath === pattern || filePath.endsWith('/' + pattern);
  }

  printRules(): void {
    console.log(chalk.blue('\n📋 CODEOWNERS Rules:'));
    this.rules.forEach(rule => {
      console.log(`  ${rule.pattern} → ${rule.owners.join(', ')}`);
    });
    console.log();
  }
}

// =============================================================================
// PR Notifier
// =============================================================================

class PRNotifier {
  private codeowners = new CodeownersParser();
  private validator = new QuarantineValidator();

  /**
   * Analyze quarantine changes between two commits or configs
   */
  async analyzeQuarantineChanges(
    currentConfigPath: string,
    previousConfigPath?: string
  ): Promise<QuarantineChange[]> {
    const changes: QuarantineChange[] = [];

    // Load current config
    const currentValidation = await this.validator.validateFile(currentConfigPath);
    if (!currentValidation.isValid || !currentValidation.config) {
      console.log(chalk.red('❌ Invalid current quarantine config'));
      return changes;
    }

    const currentTests = new Map();
    currentValidation.config.quarantined_tests.forEach(test => {
      currentTests.set(test.test_key, test);
    });

    // Load previous config if provided
    let previousTests = new Map();
    if (previousConfigPath) {
      try {
        const previousValidation = await this.validator.validateFile(previousConfigPath);
        if (previousValidation.isValid && previousValidation.config) {
          previousValidation.config.quarantined_tests.forEach(test => {
            previousTests.set(test.test_key, test);
          });
        }
      } catch {
        // Previous config doesn't exist or is invalid - treat as empty
      }
    }

    // Find added tests
    for (const [testKey, test] of currentTests) {
      if (!previousTests.has(testKey)) {
        changes.push({
          type: 'added',
          testKey,
          reason: test.reason,
          ownerTeam: test.owner_team,
          ttlDays: this.calculateTTLDays(test.quarantined_at, test.expires_at),
          priority: test.priority,
          jiraTicket: test.jira_ticket,
          filePath: this.extractFilePath(testKey),
        });
      } else {
        // Check if modified
        const previousTest = previousTests.get(testKey);
        if (JSON.stringify(test) !== JSON.stringify(previousTest)) {
          changes.push({
            type: 'modified',
            testKey,
            reason: test.reason,
            ownerTeam: test.owner_team,
            ttlDays: this.calculateTTLDays(test.quarantined_at, test.expires_at),
            priority: test.priority,
            jiraTicket: test.jira_ticket,
            filePath: this.extractFilePath(testKey),
          });
        }
      }
    }

    // Find removed tests
    for (const [testKey] of previousTests) {
      if (!currentTests.has(testKey)) {
        changes.push({
          type: 'removed',
          testKey,
          filePath: this.extractFilePath(testKey),
        });
      }
    }

    return changes;
  }

  /**
   * Enhance changes with CODEOWNERS information
   */
  async enhanceWithCodeowners(
    changes: QuarantineChange[],
    repoPath: string
  ): Promise<QuarantineChange[]> {
    await this.codeowners.loadCodeowners(repoPath);

    return changes.map(change => {
      const owners = this.codeowners.findOwners(change.filePath);
      return { ...change, codeowners: owners };
    });
  }

  /**
   * Generate consolidated PR comment
   */
  generatePRComment(changes: QuarantineChange[]): string {
    if (changes.length === 0) {
      return '';
    }

    const added = changes.filter(c => c.type === 'added');
    const removed = changes.filter(c => c.type === 'removed');
    const modified = changes.filter(c => c.type === 'modified');

    const allOwners = new Set<string>();
    const allTeams = new Set<string>();
    
    changes.forEach(change => {
      if (change.codeowners) {
        change.codeowners.forEach(owner => allOwners.add(owner));
      }
      if (change.ownerTeam) {
        allTeams.add(change.ownerTeam);
      }
    });

    let comment = `## 🔒 FlakeGuard Quarantine Changes\n\n`;

    // Summary
    comment += `### 📊 Summary\n\n`;
    comment += `| Change Type | Count |\n`;
    comment += `|-------------|-------|\n`;
    comment += `| ➕ **Added** | ${added.length} |\n`;
    comment += `| ➖ **Removed** | ${removed.length} |\n`;
    comment += `| 📝 **Modified** | ${modified.length} |\n`;
    comment += `\n`;

    // Owner notifications
    if (allOwners.size > 0 || allTeams.size > 0) {
      comment += `### 👥 Notifications\n\n`;
      
      if (allOwners.size > 0) {
        const ownerMentions = Array.from(allOwners).map(owner => `@${owner}`).join(' ');
        comment += `**Code Owners:** ${ownerMentions}\n`;
      }
      
      if (allTeams.size > 0) {
        const teamMentions = Array.from(allTeams).join(', ');
        comment += `**Teams:** ${teamMentions}\n`;
      }
      comment += `\n`;
    }

    // Added quarantines
    if (added.length > 0) {
      comment += `### ➕ Added Quarantines (${added.length})\n\n`;
      added.forEach(change => {
        comment += `#### \`${change.testKey}\`\n`;
        comment += `- **Reason:** ${change.reason}\n`;
        comment += `- **Owner Team:** ${change.ownerTeam}\n`;
        comment += `- **TTL:** ${change.ttlDays} days\n`;
        comment += `- **Priority:** ${change.priority}\n`;
        
        if (change.jiraTicket) {
          comment += `- **Jira:** ${change.jiraTicket}\n`;
        }
        
        if (change.codeowners && change.codeowners.length > 0) {
          const ownerMentions = change.codeowners.map(owner => `@${owner}`).join(' ');
          comment += `- **Code Owners:** ${ownerMentions}\n`;
        }
        
        comment += `- **File:** \`${change.filePath}\`\n`;
        
        comment += `\n`;
      });
    }

    // Removed quarantines
    if (removed.length > 0) {
      comment += `### ➖ Removed Quarantines (${removed.length})\n\n`;
      removed.forEach(change => {
        comment += `- \`${change.testKey}\``;
        if (change.codeowners && change.codeowners.length > 0) {
          const ownerMentions = change.codeowners.map(owner => `@${owner}`).join(' ');
          comment += ` (${ownerMentions})`;
        }
        comment += `\n`;
      });
      comment += `\n`;
    }

    // Modified quarantines
    if (modified.length > 0) {
      comment += `### 📝 Modified Quarantines (${modified.length})\n\n`;
      modified.forEach(change => {
        comment += `#### \`${change.testKey}\`\n`;
        comment += `- **Updated TTL:** ${change.ttlDays} days\n`;
        comment += `- **Priority:** ${change.priority}\n`;
        
        if (change.codeowners && change.codeowners.length > 0) {
          const ownerMentions = change.codeowners.map(owner => `@${owner}`).join(' ');
          comment += `- **Code Owners:** ${ownerMentions}\n`;
        }
        
        comment += `\n`;
      });
    }

    // Footer
    comment += `---\n`;
    comment += `<sub>🤖 This comment was automatically generated by FlakeGuard. `;
    comment += `Changes take effect immediately after merge.</sub>\n`;

    return comment;
  }

  /**
   * Post comment to GitHub PR using REST API
   */
  async postPRComment(
    repo: string,
    prNumber: number,
    comment: string,
    githubToken: string
  ): Promise<GitHubAPIResponse> {
    if (!comment.trim()) {
      return { success: true, data: { message: 'No comment to post' } };
    }

    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      return { success: false, error: 'Invalid repository format. Expected: owner/repo' };
    }

    console.log(chalk.blue('📤 Posting PR comment...'));
    console.log(chalk.gray(`Repository: ${repo}`));
    console.log(chalk.gray(`PR Number: ${prNumber}`));
    console.log(chalk.gray(`Comment Length: ${comment.length} characters`));

    try {
      // Use GitHub CLI for simplicity, but could use direct HTTP requests
      const result = await this.runCommand('gh', [
        'api',
        `repos/${owner}/${repoName}/issues/${prNumber}/comments`,
        '--method', 'POST',
        '--field', `body=${comment}`,
        '--header', `Authorization: token ${githubToken}`,
        '--header', 'Accept: application/vnd.github.v3+json'
      ]);

      if (result.success) {
        const response = result.output ? JSON.parse(result.output) : {};
        console.log(chalk.green('✅ PR comment posted successfully'));
        console.log(chalk.gray(`Comment URL: ${response.html_url || 'N/A'}`));
        return { success: true, data: response };
      } else {
        console.log(chalk.red('❌ Failed to post PR comment'));
        console.log(chalk.red(result.error));
        return { success: false, error: result.error };
      }
    } catch (error) {
      const errorMessage = `Failed to post PR comment: ${error}`;
      console.log(chalk.red('❌ ' + errorMessage));
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update existing PR comment if it exists
   */
  async updateOrCreatePRComment(
    repo: string,
    prNumber: number,
    comment: string,
    githubToken: string
  ): Promise<GitHubAPIResponse> {
    // First, try to find existing FlakeGuard comment
    const existingComment = await this.findFlakeGuardComment(repo, prNumber, githubToken);
    
    if (existingComment) {
      console.log(chalk.blue('📝 Updating existing FlakeGuard comment...'));
      return await this.updatePRComment(repo, existingComment.id, comment, githubToken);
    } else {
      console.log(chalk.blue('📤 Creating new FlakeGuard comment...'));
      return await this.postPRComment(repo, prNumber, comment, githubToken);
    }
  }

  private async findFlakeGuardComment(
    repo: string,
    prNumber: number,
    githubToken: string
  ): Promise<{ id: number; body: string } | null> {
    const [owner, repoName] = repo.split('/');
    
    try {
      const result = await this.runCommand('gh', [
        'api',
        `repos/${owner}/${repoName}/issues/${prNumber}/comments`,
        '--header', `Authorization: token ${githubToken}`,
        '--header', 'Accept: application/vnd.github.v3+json'
      ]);

      if (result.success && result.output) {
        const comments = JSON.parse(result.output);
        
        // Find comment with FlakeGuard marker
        const flakeGuardComment = comments.find((comment: any) => 
          comment.body.includes('🔒 FlakeGuard Quarantine Changes') ||
          comment.body.includes('This comment was automatically generated by FlakeGuard')
        );

        if (flakeGuardComment) {
          return {
            id: flakeGuardComment.id,
            body: flakeGuardComment.body
          };
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Failed to check for existing comments: ${error}`));
    }

    return null;
  }

  private async updatePRComment(
    repo: string,
    commentId: number,
    comment: string,
    githubToken: string
  ): Promise<GitHubAPIResponse> {
    const [owner, repoName] = repo.split('/');
    
    try {
      const result = await this.runCommand('gh', [
        'api',
        `repos/${owner}/${repoName}/issues/comments/${commentId}`,
        '--method', 'PATCH',
        '--field', `body=${comment}`,
        '--header', `Authorization: token ${githubToken}`,
        '--header', 'Accept: application/vnd.github.v3+json'
      ]);

      if (result.success) {
        console.log(chalk.green('✅ PR comment updated successfully'));
        const response = result.output ? JSON.parse(result.output) : {};
        return { success: true, data: response };
      } else {
        console.log(chalk.red('❌ Failed to update PR comment'));
        return { success: false, error: result.error };
      }
    } catch (error) {
      const errorMessage = `Failed to update PR comment: ${error}`;
      console.log(chalk.red('❌ ' + errorMessage));
      return { success: false, error: errorMessage };
    }
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  private calculateTTLDays(quarantinedAt: string, expiresAt: string): number {
    const start = new Date(quarantinedAt);
    const end = new Date(expiresAt);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  private extractFilePath(testKey: string): string {
    // Extract file path from test key format: "suite::name::file"
    const parts = testKey.split('::');
    if (parts.length >= 3) {
      const filePath = parts[parts.length - 1];
      return filePath || testKey;
    }
    return testKey; // Return test key as fallback
  }

  private runCommand(command: string, args: string[]): Promise<{success: boolean; output?: string; error?: string}> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { 
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({ 
            success: false, 
            error: stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`
          });
        }
      });

      proc.on('error', (error) => {
        resolve({ 
          success: false, 
          error: `Failed to spawn command: ${error.message}`
        });
      });
    });
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  program
    .name('flakeguard-pr-notifier')
    .description('FlakeGuard PR comment notifier for quarantine changes')
    .version('1.0.0');

  program
    .command('notify')
    .description('Analyze quarantine changes and post PR comment')
    .requiredOption('--repo <owner/repo>', 'Repository in owner/repo format')
    .requiredOption('--pr-number <number>', 'Pull request number')
    .requiredOption('--config <file>', 'Path to current quarantine config')
    .option('--previous-config <file>', 'Path to previous quarantine config for comparison')
    .option('--github-token <token>', 'GitHub token for API access', process.env.GITHUB_TOKEN)
    .option('--repo-path <path>', 'Path to repository root', '.')
    .option('--dry-run', 'Generate comment without posting')
    .option('--update-existing', 'Update existing FlakeGuard comment instead of creating new one')
    .action(async (options) => {
      try {
        const notifier = new PRNotifier();
        
        console.log(chalk.blue('🔍 Analyzing quarantine changes...'));
        
        // Analyze changes
        const changes = await notifier.analyzeQuarantineChanges(
          options.config,
          options.previousConfig
        );

        if (changes.length === 0) {
          console.log(chalk.green('✅ No quarantine changes detected'));
          process.exit(0);
        }

        console.log(chalk.gray(`📊 Found ${changes.length} quarantine changes`));

        // Enhance with CODEOWNERS
        const enhancedChanges = await notifier.enhanceWithCodeowners(
          changes,
          options.repoPath
        );

        // Generate comment
        const comment = notifier.generatePRComment(enhancedChanges);

        if (options.dryRun) {
          console.log(chalk.blue('\n📝 Generated PR Comment (Dry Run):'));
          console.log('='.repeat(50));
          console.log(comment);
          console.log('='.repeat(50));
          process.exit(0);
        }

        if (!options.githubToken) {
          console.log(chalk.red('❌ GitHub token is required (--github-token or GITHUB_TOKEN env var)'));
          process.exit(1);
        }

        // Post comment
        const prNumber = parseInt(options.prNumber);
        const result = options.updateExisting 
          ? await notifier.updateOrCreatePRComment(options.repo, prNumber, comment, options.githubToken)
          : await notifier.postPRComment(options.repo, prNumber, comment, options.githubToken);

        if (result.success) {
          console.log(chalk.green('🎉 PR notification completed successfully'));
          process.exit(0);
        } else {
          console.log(chalk.red('❌ PR notification failed'));
          console.log(chalk.red(result.error));
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red('❌ PR notification failed:'), error);
        process.exit(1);
      }
    });

  program
    .command('test-codeowners')
    .description('Test CODEOWNERS parsing for a file path')
    .requiredOption('--file-path <path>', 'File path to test')
    .option('--repo-path <path>', 'Path to repository root', '.')
    .action(async (options) => {
      const notifier = new PRNotifier();
      await notifier['codeowners'].loadCodeowners(options.repoPath);
      notifier['codeowners'].printRules();
      
      const owners = notifier['codeowners'].findOwners(options.filePath);
      console.log(chalk.blue(`\n📁 File: ${options.filePath}`));
      console.log(chalk.green(`👥 Owners: ${owners.length > 0 ? owners.join(', ') : 'None'}`));
    });

  program.parse();
}

// Run main function if this script is executed directly
const scriptPath = import.meta.url;
const argv1 = process.argv[1];
const isMainModule = argv1 && (
  scriptPath === `file://${argv1}` || 
  argv1.endsWith('pr-notifier.js')
);

if (isMainModule) {
  main().catch(console.error);
}

export { PRNotifier, CodeownersParser };