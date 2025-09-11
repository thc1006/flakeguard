#!/usr/bin/env tsx

/**
 * FlakeGuard Quarantine Rules Validator
 * 
 * Validates quarantine.yml schema, checks TTL expiration, and provides
 * derived fields like will-expire-in-days for reporting.
 */

import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { promises as fs } from 'fs';
import chalk from 'chalk';

// =============================================================================
// Schema Definition
// =============================================================================

const QuarantinedTestSchema = z.object({
  test_key: z.string().min(1, "test_key is required and cannot be empty"),
  reason: z.string().min(10, "reason must be at least 10 characters"),
  quarantined_by: z.string().email("quarantined_by must be a valid email"),
  quarantined_at: z.string().datetime("quarantined_at must be valid ISO datetime"),
  expires_at: z.string().datetime("expires_at must be valid ISO datetime"),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  jira_ticket: z.string().optional(),
  owner_team: z.string().min(1, "owner_team is required"),
  notes: z.string().optional(),
  auto_extend: z.boolean().default(false),
});

const QuarantineSettingsSchema = z.object({
  default_ttl_days: z.number().min(1).max(90).default(14),
  max_ttl_days: z.number().min(1).max(365).default(30),
  auto_extend_ttl: z.boolean().default(false),
  require_jira_ticket: z.boolean().default(false),
  notifications: z.object({
    ttl_warning_days: z.number().min(1).max(30).default(3),
    slack_webhook: z.string().url().optional().nullable(),
    notify_teams: z.array(z.string()).default([]),
  }).default({}),
}).default({});

const QuarantineMetadataSchema = z.object({
  created_at: z.string().datetime().optional(),
  last_updated: z.string().datetime().optional(),
  updated_by: z.string().optional(),
  schema_version: z.string().default('1.0'),
}).default({});

const QuarantineConfigSchema = z.object({
  version: z.string().regex(/^\d+\.\d+$/, "version must be in format X.Y"),
  quarantined_tests: z.array(QuarantinedTestSchema),
  settings: QuarantineSettingsSchema,
  metadata: QuarantineMetadataSchema,
});

// =============================================================================
// Types
// =============================================================================

export type QuarantinedTest = z.infer<typeof QuarantinedTestSchema>;
export type QuarantineSettings = z.infer<typeof QuarantineSettingsSchema>;
export type QuarantineMetadata = z.infer<typeof QuarantineMetadataSchema>;
export type QuarantineConfig = z.infer<typeof QuarantineConfigSchema>;

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  config?: QuarantineConfig;
}

export interface TTLStatus {
  testKey: string;
  status: 'active' | 'expiring_soon' | 'expired';
  expiresAt: Date;
  daysUntilExpiration: number;
  priority: string;
  ownerTeam: string;
  jiraTicket?: string;
}

export interface QuarantineSummary {
  totalQuarantined: number;
  activeTests: number;
  expiringSoon: number;
  expired: number;
  byPriority: Record<string, number>;
  byTeam: Record<string, number>;
  ttlStatuses: TTLStatus[];
  averageTtlDays: number;
  oldestQuarantine: {
    testKey: string;
    daysOld: number;
  } | null;
}

// =============================================================================
// Validator Class
// =============================================================================

export class QuarantineValidator {

  /**
   * Validate quarantine configuration from file
   */
  async validateFile(configPath: string): Promise<ValidationResult> {
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      return this.validateContent(configContent, configPath);
    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to read quarantine config: ${error}`],
        warnings: []
      };
    }
  }

  /**
   * Validate quarantine configuration from content string
   */
  validateContent(content: string, _filePath?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Parse YAML
      const parsed = parseYaml(content);
      
      if (!parsed) {
        return {
          isValid: false,
          errors: ['Quarantine config is empty or invalid YAML'],
          warnings: []
        };
      }

      // Validate against schema
      const result = QuarantineConfigSchema.safeParse(parsed);
      
      if (!result.success) {
        const schemaErrors = result.error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        );
        errors.push(...schemaErrors);
      }

      if (errors.length > 0) {
        return { isValid: false, errors, warnings };
      }

      const config = result.data!;

      // Additional business logic validation
      const businessValidation = this.validateBusinessRules(config);
      errors.push(...businessValidation.errors);
      warnings.push(...businessValidation.warnings);

      // TTL validation
      const ttlValidation = this.validateTTLs(config);
      errors.push(...ttlValidation.errors);
      warnings.push(...ttlValidation.warnings);

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        config: errors.length === 0 ? config : undefined
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`YAML parsing failed: ${error}`],
        warnings: []
      };
    }
  }

  /**
   * Validate business rules
   */
  private validateBusinessRules(config: QuarantineConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const testKeys = new Set<string>();

    // Check for duplicate test keys
    for (const test of config.quarantined_tests) {
      if (testKeys.has(test.test_key)) {
        errors.push(`Duplicate test key: ${test.test_key}`);
      } else {
        testKeys.add(test.test_key);
      }

      // Check quarantine vs expiry dates
      const quarantinedAt = new Date(test.quarantined_at);
      const expiresAt = new Date(test.expires_at);
      
      if (expiresAt <= quarantinedAt) {
        errors.push(`Test ${test.test_key}: expires_at must be after quarantined_at`);
      }

      // Check TTL against max allowed
      const ttlDays = Math.ceil((expiresAt.getTime() - quarantinedAt.getTime()) / (1000 * 60 * 60 * 24));
      if (ttlDays > config.settings.max_ttl_days) {
        errors.push(`Test ${test.test_key}: TTL of ${ttlDays} days exceeds maximum of ${config.settings.max_ttl_days} days`);
      }

      // Warn about long TTLs
      if (ttlDays > config.settings.default_ttl_days * 2) {
        warnings.push(`Test ${test.test_key}: TTL of ${ttlDays} days is longer than recommended (${config.settings.default_ttl_days} days)`);
      }

      // Check for missing Jira ticket if required
      if (config.settings.require_jira_ticket && !test.jira_ticket) {
        errors.push(`Test ${test.test_key}: Jira ticket is required but missing`);
      }

      // Validate test key format (should be suite::name::file)
      const keyParts = test.test_key.split('::');
      if (keyParts.length < 2) {
        warnings.push(`Test ${test.test_key}: Consider using format 'suite::name::file' for better organization`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate TTLs and check expiration status
   */
  private validateTTLs(config: QuarantineConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const now = new Date();

    for (const test of config.quarantined_tests) {
      const expiresAt = new Date(test.expires_at);
      const daysUntilExpiration = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiration < 0) {
        errors.push(`Test ${test.test_key}: Quarantine expired ${Math.abs(daysUntilExpiration)} days ago`);
      } else if (daysUntilExpiration <= config.settings.notifications.ttl_warning_days) {
        warnings.push(`Test ${test.test_key}: Quarantine expires in ${daysUntilExpiration} days`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Generate comprehensive quarantine summary with derived fields
   */
  generateSummary(config: QuarantineConfig): QuarantineSummary {
    const now = new Date();
    const ttlStatuses: TTLStatus[] = [];
    const byPriority: Record<string, number> = {};
    const byTeam: Record<string, number> = {};
    
    let expiringSoon = 0;
    let expired = 0;
    let totalTtlDays = 0;
    let oldestQuarantine: { testKey: string; daysOld: number } | null = null;

    for (const test of config.quarantined_tests) {
      const quarantinedAt = new Date(test.quarantined_at);
      const expiresAt = new Date(test.expires_at);
      const daysUntilExpiration = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const daysOld = Math.ceil((now.getTime() - quarantinedAt.getTime()) / (1000 * 60 * 60 * 24));
      
      // Calculate TTL status
      let status: 'active' | 'expiring_soon' | 'expired';
      if (daysUntilExpiration < 0) {
        status = 'expired';
        expired++;
      } else if (daysUntilExpiration <= config.settings.notifications.ttl_warning_days) {
        status = 'expiring_soon';
        expiringSoon++;
      } else {
        status = 'active';
      }

      ttlStatuses.push({
        testKey: test.test_key,
        status,
        expiresAt,
        daysUntilExpiration,
        priority: test.priority,
        ownerTeam: test.owner_team,
        jiraTicket: test.jira_ticket,
      });

      // Track by priority
      byPriority[test.priority] = (byPriority[test.priority] || 0) + 1;
      
      // Track by team
      byTeam[test.owner_team] = (byTeam[test.owner_team] || 0) + 1;
      
      // Calculate averages and oldest
      const ttlDays = Math.ceil((expiresAt.getTime() - quarantinedAt.getTime()) / (1000 * 60 * 60 * 24));
      totalTtlDays += ttlDays;
      
      if (!oldestQuarantine || daysOld > oldestQuarantine.daysOld) {
        oldestQuarantine = { testKey: test.test_key, daysOld };
      }
    }

    const totalQuarantined = config.quarantined_tests.length;
    const activeTests = totalQuarantined - expired;

    return {
      totalQuarantined,
      activeTests,
      expiringSoon,
      expired,
      byPriority,
      byTeam,
      ttlStatuses,
      averageTtlDays: totalQuarantined > 0 ? Math.round(totalTtlDays / totalQuarantined) : 0,
      oldestQuarantine,
    };
  }

  /**
   * Generate a new quarantine entry with defaults
   */
  generateQuarantineEntry(
    testKey: string,
    reason: string,
    ownerTeam: string,
    quarantinedBy: string,
    options: {
      ttlDays?: number;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      jiraTicket?: string;
      notes?: string;
    } = {}
  ): QuarantinedTest {
    const now = new Date();
    const ttlDays = options.ttlDays || 14;
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    return {
      test_key: testKey,
      reason,
      quarantined_by: quarantinedBy,
      quarantined_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      priority: options.priority || 'medium',
      jira_ticket: options.jiraTicket,
      owner_team: ownerTeam,
      notes: options.notes,
      auto_extend: false,
    };
  }

  /**
   * Add a test to quarantine configuration
   */
  async addToQuarantine(
    configPath: string,
    testKey: string,
    reason: string,
    ownerTeam: string,
    quarantinedBy: string,
    options: Parameters<typeof this.generateQuarantineEntry>[4] = {}
  ): Promise<ValidationResult> {
    try {
      // Load existing config or create new one
      let config: QuarantineConfig;
      
      try {
        const validation = await this.validateFile(configPath);
        if (validation.isValid && validation.config) {
          config = validation.config;
        } else {
          // Create new config if file doesn't exist or is invalid
          config = {
            version: '1.0',
            quarantined_tests: [],
            settings: {
              default_ttl_days: 14,
              max_ttl_days: 30,
              auto_extend_ttl: false,
              require_jira_ticket: false,
              notifications: {
                ttl_warning_days: 3,
                slack_webhook: null,
                notify_teams: [],
              },
            },
            metadata: {
              created_at: new Date().toISOString(),
              last_updated: new Date().toISOString(),
              updated_by: quarantinedBy,
              schema_version: '1.0',
            },
          };
        }
      } catch {
        // File doesn't exist, create new config
        config = {
          version: '1.0',
          quarantined_tests: [],
          settings: {
            default_ttl_days: 14,
            max_ttl_days: 30,
            auto_extend_ttl: false,
            require_jira_ticket: false,
            notifications: {
              ttl_warning_days: 3,
              slack_webhook: null,
              notify_teams: [],
            },
          },
          metadata: {
            created_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            updated_by: quarantinedBy,
            schema_version: '1.0',
          },
        };
      }

      // Check if test is already quarantined
      const existingIndex = config.quarantined_tests.findIndex(t => t.test_key === testKey);
      
      const newEntry = this.generateQuarantineEntry(testKey, reason, ownerTeam, quarantinedBy, {
        ttlDays: options.ttlDays || config.settings.default_ttl_days,
        ...options
      });

      if (existingIndex >= 0) {
        // Update existing entry
        config.quarantined_tests[existingIndex] = newEntry;
      } else {
        // Add new entry
        config.quarantined_tests.push(newEntry);
      }

      // Update metadata
      config.metadata.last_updated = new Date().toISOString();
      config.metadata.updated_by = quarantinedBy;

      // Validate the updated config
      const validation = this.validateContent(JSON.stringify(config));
      if (!validation.isValid) {
        return validation;
      }

      // Save to file
      const { stringify } = await import('yaml');
      const yamlContent = stringify(config, {
        indent: 2,
      });

      await fs.writeFile(configPath, yamlContent, 'utf-8');

      return {
        isValid: true,
        errors: [],
        warnings: [`Successfully ${existingIndex >= 0 ? 'updated' : 'added'} quarantine for ${testKey}`],
        config
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to add quarantine entry: ${error}`],
        warnings: []
      };
    }
  }

  /**
   * Remove a test from quarantine
   */
  async removeFromQuarantine(configPath: string, testKey: string, removedBy: string): Promise<ValidationResult> {
    try {
      const validation = await this.validateFile(configPath);
      if (!validation.isValid || !validation.config) {
        return validation;
      }

      const config = validation.config;
      const initialCount = config.quarantined_tests.length;
      
      // Remove the test
      config.quarantined_tests = config.quarantined_tests.filter(t => t.test_key !== testKey);
      
      if (config.quarantined_tests.length === initialCount) {
        return {
          isValid: false,
          errors: [`Test ${testKey} not found in quarantine`],
          warnings: []
        };
      }

      // Update metadata
      config.metadata.last_updated = new Date().toISOString();
      config.metadata.updated_by = removedBy;

      // Save to file
      const { stringify } = await import('yaml');
      const yamlContent = stringify(config, {
        indent: 2,
      });

      await fs.writeFile(configPath, yamlContent, 'utf-8');

      return {
        isValid: true,
        errors: [],
        warnings: [`Successfully removed quarantine for ${testKey}`],
        config
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Failed to remove quarantine entry: ${error}`],
        warnings: []
      };
    }
  }

  /**
   * Print validation results with colors
   */
  printValidationResult(result: ValidationResult, configPath?: string): void {
    if (configPath) {
      console.log(chalk.blue(`\n📋 Quarantine Config Validation: ${configPath}`));
    } else {
      console.log(chalk.blue(`\n📋 Quarantine Config Validation`));
    }
    console.log('='.repeat(50));

    if (result.isValid) {
      console.log(chalk.green('✅ Configuration is valid'));
    } else {
      console.log(chalk.red('❌ Configuration has errors'));
    }

    if (result.errors.length > 0) {
      console.log(chalk.red('\n🚫 Errors:'));
      result.errors.forEach(error => {
        console.log(chalk.red(`  • ${error}`));
      });
    }

    if (result.warnings.length > 0) {
      console.log(chalk.yellow('\n⚠️  Warnings:'));
      result.warnings.forEach(warning => {
        console.log(chalk.yellow(`  • ${warning}`));
      });
    }

    if (result.config) {
      const summary = this.generateSummary(result.config);
      console.log(chalk.blue('\n📊 Summary:'));
      console.log(chalk.gray(`  • Total quarantined: ${summary.totalQuarantined}`));
      console.log(chalk.gray(`  • Active: ${summary.activeTests}`));
      console.log(chalk.gray(`  • Expiring soon: ${summary.expiringSoon}`));
      console.log(chalk.gray(`  • Expired: ${summary.expired}`));
      console.log(chalk.gray(`  • Average TTL: ${summary.averageTtlDays} days`));
    }

    console.log();
  }

  /**
   * Print detailed quarantine summary
   */
  printSummary(summary: QuarantineSummary): void {
    console.log(chalk.blue('\n📊 Detailed Quarantine Summary'));
    console.log('='.repeat(50));

    // Overview
    console.log(chalk.bold('\n🎯 Overview:'));
    console.log(`  • Total quarantined tests: ${summary.totalQuarantined}`);
    console.log(`  • Currently active: ${summary.activeTests}`);
    console.log(`  • Expiring soon (${summary.expiringSoon}): ${chalk.yellow('⚠️')}`);
    console.log(`  • Already expired: ${summary.expired > 0 ? chalk.red(summary.expired) : summary.expired}`);
    console.log(`  • Average TTL: ${summary.averageTtlDays} days`);

    if (summary.oldestQuarantine) {
      console.log(`  • Oldest quarantine: ${summary.oldestQuarantine.testKey} (${summary.oldestQuarantine.daysOld} days old)`);
    }

    // By Priority
    if (Object.keys(summary.byPriority).length > 0) {
      console.log(chalk.bold('\n🎯 By Priority:'));
      Object.entries(summary.byPriority)
        .sort(([,a], [,b]) => b - a)
        .forEach(([priority, count]) => {
          const color = priority === 'critical' ? chalk.red : priority === 'high' ? chalk.yellow : chalk.gray;
          console.log(`  • ${color(priority)}: ${count}`);
        });
    }

    // By Team
    if (Object.keys(summary.byTeam).length > 0) {
      console.log(chalk.bold('\n👥 By Team:'));
      Object.entries(summary.byTeam)
        .sort(([,a], [,b]) => b - a)
        .forEach(([team, count]) => {
          console.log(`  • ${team}: ${count}`);
        });
    }

    // TTL Statuses
    if (summary.ttlStatuses.length > 0) {
      console.log(chalk.bold('\n⏰ TTL Status:'));
      summary.ttlStatuses.forEach(status => {
        const statusIcon = status.status === 'expired' ? chalk.red('❌') : 
                          status.status === 'expiring_soon' ? chalk.yellow('⚠️') : 
                          chalk.green('✅');
        const daysText = status.daysUntilExpiration < 0 ? 
                        `expired ${Math.abs(status.daysUntilExpiration)} days ago` :
                        `${status.daysUntilExpiration} days left`;
        
        console.log(`  ${statusIcon} ${status.testKey}`);
        console.log(`      ${daysText} | ${status.priority} | ${status.ownerTeam}`);
        if (status.jiraTicket) {
          console.log(`      Jira: ${status.jiraTicket}`);
        }
      });
    }

    console.log();
  }
}