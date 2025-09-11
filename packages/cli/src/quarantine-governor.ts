#!/usr/bin/env node

/**
 * Quarantine Governor & PR Notifier
 * Maintains .flakeguard/quarantine.yml with TTL validation
 * and notifies owners on PR with consolidated comments
 */

import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';

// Schema for quarantine entry
const QuarantineEntrySchema = z.object({
  testKey: z.string().min(1, 'Test key cannot be empty'),
  owner: z.string().min(1, 'Owner cannot be empty'), 
  reason: z.string().min(1, 'Reason cannot be empty'),
  until: z.string().datetime('Invalid ISO date format for until field'),
  quarantinedAt: z.string().datetime().optional(),
  environment: z.string().optional(),
  issueUrl: z.string().url().optional()
});

const QuarantineConfigSchema = z.object({
  version: z.literal('1.0').default('1.0'),
  entries: z.array(QuarantineEntrySchema).default([])
});

type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;
type QuarantineConfig = z.infer<typeof QuarantineConfigSchema>;

interface CodeOwner {
  pattern: string;
  owners: string[];
  isGlobal: boolean;
}

interface TestFailure {
  testKey: string;
  name: string;
  file: string;
  line?: number;
  message: string;
  isFlaky: boolean;
  isQuarantined: boolean;
  volatility?: number;
  frequency?: number;
}

interface GovernanceReport {
  newlyQuarantined: QuarantineEntry[];
  expiringSoon: QuarantineEntry[];
  nonQuarantinedFailures: TestFailure[];
  ownerMentions: Set<string>;
  summary: string;
}

export class QuarantineGovernor {
  private codeOwners: CodeOwner[] = [];
  
  constructor(private workspaceRoot: string = process.cwd()) {}

  /**
   * Validate quarantine configuration schema
   */
  async validateQuarantineConfig(configPath: string): Promise<QuarantineConfig> {
    try {
      if (!existsSync(configPath)) {
        // Return empty valid config if file doesn't exist
        return { version: '1.0', entries: [] };
      }

      const content = await readFile(configPath, 'utf-8');
      
      // Handle empty file
      if (!content.trim()) {
        return { version: '1.0', entries: [] };
      }

      // Parse YAML using dynamic import to avoid require() issues
      const { parse } = await import('yaml');
      const data = parse(content);
      
      // Validate against schema
      const result = QuarantineConfigSchema.parse(data);
      
      // Additional TTL validation
      this.validateTTLs(result.entries);
      
      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Quarantine config validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      throw new Error(`Failed to read quarantine config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate TTL dates are in the future and reasonable
   */
  private validateTTLs(entries: QuarantineEntry[]): void {
    const now = new Date();
    const maxTTLDays = 90; // Maximum 90 days quarantine
    
    for (const entry of entries) {
      const until = new Date(entry.until);
      
      if (until <= now) {
        console.warn(`⚠️  Quarantine entry for ${entry.testKey} has expired (until: ${entry.until})`);
      }
      
      const ttlDays = Math.ceil((until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (ttlDays > maxTTLDays) {
        console.warn(`⚠️  Quarantine entry for ${entry.testKey} has excessive TTL (${ttlDays} days, max: ${maxTTLDays})`);
      }
    }
  }

  /**
   * Parse CODEOWNERS file and build ownership mapping
   */
  async loadCodeOwners(): Promise<void> {
    const codeOwnersPath = join(this.workspaceRoot, '.github', 'CODEOWNERS');
    
    if (!existsSync(codeOwnersPath)) {
      console.warn('⚠️  No CODEOWNERS file found, using fallback ownership rules');
      this.setupFallbackOwners();
      return;
    }

    try {
      const content = await readFile(codeOwnersPath, 'utf-8');
      this.codeOwners = this.parseCodeOwners(content);
      console.log(`📋 Loaded ${this.codeOwners.length} code ownership rules`);
    } catch (error) {
      console.error(`❌ Failed to load CODEOWNERS: ${error instanceof Error ? error.message : String(error)}`);
      this.setupFallbackOwners();
    }
  }

  /**
   * Parse CODEOWNERS file content into structured rules
   * Note: Last matching pattern wins (GitHub precedence)
   */
  private parseCodeOwners(content: string): CodeOwner[] {
    const rules: CodeOwner[] = [];
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) {
        continue;
      }
      
      const [pattern, ...owners] = parts;
      if (pattern) {
        rules.push({
          pattern: pattern,
          owners: owners.filter(owner => owner.startsWith('@')),
          isGlobal: pattern === '*'
        });
      }
    }
    
    return rules;
  }

  /**
   * Setup fallback ownership rules when CODEOWNERS is missing
   */
  private setupFallbackOwners(): void {
    this.codeOwners = [
      { pattern: '*.test.ts', owners: ['@engineering'], isGlobal: false },
      { pattern: '*.test.js', owners: ['@engineering'], isGlobal: false },
      { pattern: 'src/auth/**', owners: ['@security-team'], isGlobal: false },
      { pattern: 'src/payment/**', owners: ['@payments-team'], isGlobal: false },
      { pattern: 'src/api/**', owners: ['@backend-team'], isGlobal: false },
      { pattern: 'src/ui/**', owners: ['@frontend-team'], isGlobal: false },
      { pattern: '*', owners: ['@engineering'], isGlobal: true }
    ];
  }

  /**
   * Find owners for a given file path
   * Returns the owners from the last matching pattern (GitHub precedence)
   */
  findOwnersForFile(filePath: string): string[] {
    const relativePath = relative(this.workspaceRoot, filePath);
    let matchedOwners: string[] = [];
    
    // Check each rule, last match wins
    for (const rule of this.codeOwners) {
      if (this.matchesPattern(relativePath, rule.pattern)) {
        matchedOwners = rule.owners;
      }
    }
    
    // Fallback to global owners if no specific match
    if (matchedOwners.length === 0) {
      const globalRule = this.codeOwners.find(rule => rule.isGlobal);
      matchedOwners = globalRule?.owners || ['@engineering'];
    }
    
    return matchedOwners;
  }

  /**
   * Simple glob-like pattern matching for CODEOWNERS
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\*\*/g, '.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath) || regex.test(filePath.replace(/\\/g, '/'));
  }

  /**
   * Generate governance report for PR comment
   */
  async generateGovernanceReport(
    failures: TestFailure[],
    quarantineConfig: QuarantineConfig
  ): Promise<GovernanceReport> {
    const now = new Date();
    const warningThresholdDays = 7;
    
    // Find entries expiring soon
    const expiringSoon = quarantineConfig.entries.filter(entry => {
      const until = new Date(entry.until);
      const daysRemaining = Math.ceil((until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysRemaining > 0 && daysRemaining <= warningThresholdDays;
    });

    // Find non-quarantined failures
    const quarantinedTestKeys = new Set(quarantineConfig.entries.map(e => e.testKey));
    const nonQuarantinedFailures = failures.filter(f => !quarantinedTestKeys.has(f.testKey));

    // Collect all relevant owners
    const ownerMentions = new Set<string>();
    
    // Add owners from expiring entries
    expiringSoon.forEach(entry => {
      ownerMentions.add(entry.owner);
    });
    
    // Add owners for non-quarantined failures
    for (const failure of nonQuarantinedFailures) {
      const owners = this.findOwnersForFile(failure.file);
      owners.forEach(owner => ownerMentions.add(owner));
    }

    // Generate summary
    const summary = this.buildGovernanceSummary({
      totalFailures: failures.length,
      quarantinedCount: failures.filter(f => f.isQuarantined).length,
      expiringSoonCount: expiringSoon.length,
      nonQuarantinedCount: nonQuarantinedFailures.length
    });

    return {
      newlyQuarantined: [], // Will be populated when adding new entries
      expiringSoon,
      nonQuarantinedFailures,
      ownerMentions,
      summary
    };
  }

  /**
   * Build governance summary text
   */
  private buildGovernanceSummary(stats: {
    totalFailures: number;
    quarantinedCount: number;
    expiringSoonCount: number;
    nonQuarantinedCount: number;
  }): string {
    const { totalFailures, quarantinedCount, expiringSoonCount, nonQuarantinedCount } = stats;
    
    if (totalFailures === 0) {
      return '✅ No test failures detected';
    }
    
    const parts = [
      `📊 **${totalFailures}** total failure${totalFailures === 1 ? '' : 's'}`,
      `🔒 **${quarantinedCount}** quarantined`,
      `⚠️ **${expiringSoonCount}** expiring soon`,
      `🚨 **${nonQuarantinedCount}** requiring action`
    ];
    
    return parts.join(' • ');
  }

  /**
   * Generate consolidated PR comment markdown
   */
  generatePRComment(report: GovernanceReport): string {
    const { expiringSoon, nonQuarantinedFailures, ownerMentions, summary } = report;
    
    const sections = [
      '## 🛡️ FlakeGuard Governance Report',
      '',
      summary,
      ''
    ];

    // Expiring quarantines section
    if (expiringSoon.length > 0) {
      sections.push('### ⚠️ Quarantines Expiring Soon');
      sections.push('');
      sections.push('| Test | Owner | Expires | Days Left |');
      sections.push('|------|-------|---------|-----------|');
      
      for (const entry of expiringSoon) {
        const until = new Date(entry.until);
        const daysLeft = Math.ceil((until.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const daysLeftBadge = daysLeft <= 3 ? '🔴' : daysLeft <= 7 ? '🟡' : '🟢';
        
        sections.push(`| \`${entry.testKey}\` | ${entry.owner} | ${until.toISOString().split('T')[0]} | ${daysLeftBadge} **${daysLeft}** |`);
      }
      sections.push('');
    }

    // Non-quarantined failures section
    if (nonQuarantinedFailures.length > 0) {
      sections.push('### 🚨 Failures Requiring Action');
      sections.push('');
      sections.push('| Test | File | Type | Owners |');
      sections.push('|------|------|------|--------|');
      
      for (const failure of nonQuarantinedFailures.slice(0, 10)) { // Limit to 10 for readability
        const owners = this.findOwnersForFile(failure.file);
        const type = failure.isFlaky ? '🔄 Flaky' : '❌ Deterministic';
        
        sections.push(`| \`${failure.testKey}\` | ${failure.file}:${failure.line || '?'} | ${type} | ${owners.join(' ')} |`);
      }
      
      if (nonQuarantinedFailures.length > 10) {
        sections.push(`| ... | ... | ... | *${nonQuarantinedFailures.length - 10} more failures* |`);
      }
      sections.push('');
    }

    // Owner mentions
    if (ownerMentions.size > 0) {
      sections.push('### 👥 Action Required From');
      sections.push('');
      sections.push(Array.from(ownerMentions).join(' '));
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push('*Generated by FlakeGuard • [View Full Report](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})*');

    return sections.join('\n');
  }

  /**
   * Add new quarantine entry with validation
   */
  async addQuarantineEntry(
    configPath: string,
    entry: Omit<QuarantineEntry, 'quarantinedAt'>
  ): Promise<void> {
    const config = await this.validateQuarantineConfig(configPath);
    
    // Add timestamp
    const fullEntry: QuarantineEntry = {
      ...entry,
      quarantinedAt: new Date().toISOString()
    };
    
    // Validate the new entry
    QuarantineEntrySchema.parse(fullEntry);
    
    // Check for duplicates
    const existingIndex = config.entries.findIndex(e => e.testKey === fullEntry.testKey);
    if (existingIndex >= 0) {
      // Update existing entry
      config.entries[existingIndex] = fullEntry;
      console.log(`🔄 Updated quarantine entry for ${fullEntry.testKey}`);
    } else {
      // Add new entry
      config.entries.push(fullEntry);
      console.log(`➕ Added quarantine entry for ${fullEntry.testKey}`);
    }
    
    // Save back to file
    await this.saveQuarantineConfig(configPath, config);
  }

  /**
   * Save quarantine configuration to YAML file
   */
  private async saveQuarantineConfig(configPath: string, config: QuarantineConfig): Promise<void> {
    try {
      // Use dynamic import for YAML to avoid require() issues
      const { stringify } = await import('yaml');
      const content = stringify(config, { indent: 2 });
      await writeFile(configPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save quarantine config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Remove expired quarantine entries
   */
  async cleanupExpiredEntries(configPath: string): Promise<number> {
    const config = await this.validateQuarantineConfig(configPath);
    const now = new Date();
    
    const before = config.entries.length;
    config.entries = config.entries.filter(entry => {
      const until = new Date(entry.until);
      const isExpired = until <= now;
      
      if (isExpired) {
        console.log(`🗑️  Removing expired quarantine for ${entry.testKey} (expired: ${entry.until})`);
      }
      
      return !isExpired;
    });
    
    const removed = before - config.entries.length;
    if (removed > 0) {
      await this.saveQuarantineConfig(configPath, config);
    }
    
    return removed;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const governor = new QuarantineGovernor();
  await governor.loadCodeOwners();
  
  switch (command) {
    case 'validate': {
      const configPath = args[1] || '.flakeguard/quarantine.yml';
      try {
        const config = await governor.validateQuarantineConfig(configPath);
        console.log(`✅ Quarantine config is valid (${config.entries.length} entries)`);
        process.exit(0);
      } catch (error) {
        console.error(`❌ Validation failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      break;
    }
    
    case 'cleanup': {
      const configPath = args[1] || '.flakeguard/quarantine.yml';
      try {
        const removed = await governor.cleanupExpiredEntries(configPath);
        console.log(`🧹 Cleaned up ${removed} expired quarantine entries`);
        process.exit(0);
      } catch (error) {
        console.error(`❌ Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      break;
    }
    
    case 'report': {
      const reportPath = args[1] || '.flakeguard/out/report.json';
      const configPath = args[2] || '.flakeguard/quarantine.yml';
      
      try {
        // Read test report
        const reportContent = await readFile(reportPath, 'utf-8');
        const testReport = JSON.parse(reportContent);
        const failures = testReport.failures || [];
        
        // Load quarantine config
        const config = await governor.validateQuarantineConfig(configPath);
        
        // Generate governance report
        const report = await governor.generateGovernanceReport(failures, config);
        
        // Output PR comment markdown
        const comment = governor.generatePRComment(report);
        console.log(comment);
        
      } catch (error) {
        console.error(`❌ Report generation failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      break;
    }
    
    default:
      console.log('Usage:');
      console.log('  quarantine-governor validate [config-path]');
      console.log('  quarantine-governor cleanup [config-path]');
      console.log('  quarantine-governor report [report-path] [config-path]');
      process.exit(1);
  }
}

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('quarantine-governor.js')) {
  main().catch(console.error);
}