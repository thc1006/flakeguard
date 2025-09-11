#!/usr/bin/env node

/**
 * FlakeGuard Branch Protection Auditor
 * 
 * Analyzes GitHub Actions workflows to identify:
 * - Stable checks that should be required for branch protection
 * - Experimental/optional checks that shouldn't block merges
 * - Provides clear guidance for branch protection configuration
 */

import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { parse } from 'yaml';

interface WorkflowJob {
  name: string;
  'runs-on': string;
  if?: string;
  needs?: string | string[];
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: Record<string, any>;
  };
  steps: Array<{
    name?: string;
    run?: string;
    uses?: string;
    if?: string;
    'continue-on-error'?: boolean;
  }>;
}

interface WorkflowAnalysis {
  name: string;
  filename: string;
  triggers: string[];
  jobs: Array<{
    id: string;
    name: string;
    stability: 'stable' | 'experimental' | 'conditional' | 'optional';
    shouldBeRequired: boolean;
    reasoning: string;
    dependencies: string[];
    runsOnPR: boolean;
    runsOnMain: boolean;
    hasMatrix: boolean;
    canFail: boolean;
  }>;
}

interface BranchProtectionConfig {
  requiredChecks: string[];
  optionalChecks: string[];
  conditionalChecks: string[];
  experimentalChecks: string[];
}

class BranchProtectionAuditor {
  private workflowsDir: string;
  private workflows: WorkflowAnalysis[] = [];

  constructor(workflowsDir: string = '.github/workflows') {
    this.workflowsDir = workflowsDir;
  }

  /**
   * Analyze all workflow files
   */
  async analyzeWorkflows(): Promise<WorkflowAnalysis[]> {
    console.log('🔍 Analyzing GitHub Actions workflows...\n');

    const workflowFiles = await readdir(this.workflowsDir);
    const yamlFiles = workflowFiles.filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));

    for (const file of yamlFiles) {
      try {
        const analysis = await this.analyzeWorkflow(file);
        this.workflows.push(analysis);
        console.log(`✅ Analyzed: ${file}`);
      } catch (error) {
        console.error(`❌ Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`\n📊 Analyzed ${this.workflows.length} workflows\n`);
    return this.workflows;
  }

  /**
   * Analyze a single workflow file
   */
  private async analyzeWorkflow(filename: string): Promise<WorkflowAnalysis> {
    const filePath = join(this.workflowsDir, filename);
    const content = await readFile(filePath, 'utf-8');
    const workflow = parse(content);

    const triggers = this.extractTriggers(workflow.on);
    const analysis: WorkflowAnalysis = {
      name: workflow.name || basename(filename, '.yml'),
      filename,
      triggers,
      jobs: []
    };

    if (workflow.jobs) {
      for (const [jobId, job] of Object.entries(workflow.jobs)) {
        const jobAnalysis = this.analyzeJob(jobId, job as WorkflowJob, triggers, analysis.name);
        analysis.jobs.push(jobAnalysis);
      }
    }

    return analysis;
  }

  /**
   * Extract workflow triggers
   */
  private extractTriggers(on: any): string[] {
    if (typeof on === 'string') {
      return [on];
    }

    if (Array.isArray(on)) {
      return on;
    }

    if (typeof on === 'object') {
      return Object.keys(on);
    }

    return [];
  }

  /**
   * Analyze individual job for stability and requirement level
   */
  private analyzeJob(jobId: string, job: WorkflowJob, triggers: string[], workflowName: string): any {
    const runsOnPR = triggers.includes('pull_request');
    const runsOnMain = triggers.includes('push') || triggers.includes('workflow_run');
    const hasMatrix = Boolean(job.strategy?.matrix);
    const hasConditional = Boolean(job.if);
    const canFail = job.steps?.some(step => step['continue-on-error']) || false;
    const dependencies = Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];

    // Determine stability based on various factors
    let stability: 'stable' | 'experimental' | 'conditional' | 'optional';
    let shouldBeRequired = false;
    let reasoning = '';

    // Core pipeline jobs that should always be required
    const coreJobPatterns = [
      /^(test|tests)$/i,
      /^(lint|linting|eslint)$/i,
      /^(build|compile)$/i,
      /^(security|sec|audit)$/i,
      /^(typecheck|type-check)$/i
    ];

    // Quality assurance jobs that should be required
    const qaJobPatterns = [
      /^(unit|integration|e2e).*test/i,
      /^.*format.*check/i,
      /^.*dependency.*scan/i
    ];

    // Jobs that are experimental or optional
    const experimentalPatterns = [
      /^(performance|perf|benchmark)/i,
      /^(deploy|deployment)/i,
      /^(cleanup|summary)/i,
      /^(upload|artifact)/i,
      /^(notify|notification)/i
    ];

    // Determine job classification
    const jobName = job.name || jobId;
    const isCore = coreJobPatterns.some(pattern => pattern.test(jobName));
    const isQA = qaJobPatterns.some(pattern => pattern.test(jobName));
    const isExperimental = experimentalPatterns.some(pattern => pattern.test(jobName));

    if (isCore) {
      stability = 'stable';
      shouldBeRequired = true;
      reasoning = 'Core pipeline job essential for code quality';
    } else if (isQA) {
      stability = 'stable';
      shouldBeRequired = true;
      reasoning = 'Quality assurance job critical for reliability';
    } else if (hasConditional && !runsOnPR) {
      stability = 'conditional';
      shouldBeRequired = false;
      reasoning = 'Conditional job that may not run on all PRs';
    } else if (isExperimental) {
      stability = 'experimental';
      shouldBeRequired = false;
      reasoning = 'Experimental/optional job that shouldn\'t block merges';
    } else if (canFail) {
      stability = 'optional';
      shouldBeRequired = false;
      reasoning = 'Job configured to allow failures';
    } else if (runsOnPR && !hasConditional) {
      stability = 'stable';
      shouldBeRequired = true;
      reasoning = 'Always runs on PRs without conditions';
    } else {
      stability = 'conditional';
      shouldBeRequired = false;
      reasoning = 'Job behavior is conditional or unclear';
    }

    // Special cases for FlakeGuard workflows
    if (workflowName.toLowerCase().includes('flakeguard')) {
      if (jobName.toLowerCase().includes('ingest') || jobName.toLowerCase().includes('analysis')) {
        stability = 'stable';
        shouldBeRequired = true;
        reasoning = 'FlakeGuard core analysis - essential for test quality';
      } else {
        stability = 'optional';
        shouldBeRequired = false;
        reasoning = 'FlakeGuard supplementary job - helpful but not blocking';
      }
    }

    return {
      id: jobId,
      name: jobName,
      stability,
      shouldBeRequired,
      reasoning,
      dependencies,
      runsOnPR,
      runsOnMain,
      hasMatrix,
      canFail
    };
  }

  /**
   * Generate branch protection configuration
   */
  generateBranchProtectionConfig(): BranchProtectionConfig {
    const config: BranchProtectionConfig = {
      requiredChecks: [],
      optionalChecks: [],
      conditionalChecks: [],
      experimentalChecks: []
    };

    for (const workflow of this.workflows) {
      for (const job of workflow.jobs) {
        const checkName = `${workflow.name} / ${job.name}`;
        
        if (job.shouldBeRequired && job.runsOnPR) {
          config.requiredChecks.push(checkName);
        } else if (job.stability === 'experimental') {
          config.experimentalChecks.push(checkName);
        } else if (job.stability === 'conditional') {
          config.conditionalChecks.push(checkName);
        } else {
          config.optionalChecks.push(checkName);
        }
      }
    }

    // Sort arrays for consistent output
    config.requiredChecks.sort();
    config.optionalChecks.sort();
    config.conditionalChecks.sort();
    config.experimentalChecks.sort();

    return config;
  }

  /**
   * Generate detailed analysis report
   */
  generateDetailedReport(): string {
    let report = '# 🛡️ Branch Protection Analysis Report\n\n';
    
    report += '## 📋 Workflow Overview\n\n';
    report += '| Workflow | Jobs | Required | Optional | Conditional | Experimental |\n';
    report += '|----------|------|----------|----------|-------------|---------------|\n';

    for (const workflow of this.workflows) {
      const required = workflow.jobs.filter(j => j.shouldBeRequired).length;
      const optional = workflow.jobs.filter(j => j.stability === 'optional').length;
      const conditional = workflow.jobs.filter(j => j.stability === 'conditional').length;
      const experimental = workflow.jobs.filter(j => j.stability === 'experimental').length;

      report += `| **${workflow.name}** | ${workflow.jobs.length} | ${required} | ${optional} | ${conditional} | ${experimental} |\n`;
    }

    report += '\n## 🔍 Detailed Job Analysis\n\n';

    for (const workflow of this.workflows) {
      report += `### ${workflow.name}\n`;
      report += `**File:** \`${workflow.filename}\`  \n`;
      report += `**Triggers:** ${workflow.triggers.join(', ')}\n\n`;

      if (workflow.jobs.length === 0) {
        report += '*No jobs found in this workflow.*\n\n';
        continue;
      }

      report += '| Job | Status | Stability | Required | Reasoning |\n';
      report += '|-----|--------|-----------|----------|------------|\n';

      for (const job of workflow.jobs) {
        const statusIcon = job.shouldBeRequired ? '✅' : 
                          job.stability === 'experimental' ? '🧪' :
                          job.stability === 'conditional' ? '⚠️' : '📝';
        
        report += `| **${job.name}** | ${statusIcon} | ${job.stability} | ${job.shouldBeRequired ? 'Yes' : 'No'} | ${job.reasoning} |\n`;
      }

      report += '\n';
    }

    return report;
  }

  /**
   * Generate branch protection configuration guidance
   */
  generateBranchProtectionGuidance(): string {
    const config = this.generateBranchProtectionConfig();
    
    let guidance = '# 🔒 Branch Protection Configuration Guide\n\n';
    
    guidance += '## Required Status Checks\n\n';
    guidance += 'Configure these checks as **required** in your branch protection rules. PRs cannot be merged until these pass:\n\n';
    
    if (config.requiredChecks.length === 0) {
      guidance += '*No required checks identified.*\n\n';
    } else {
      guidance += '```yaml\n';
      guidance += 'required_status_checks:\n';
      guidance += '  strict: true  # Require branches to be up to date before merging\n';
      guidance += '  contexts:\n';
      for (const check of config.requiredChecks) {
        guidance += `    - "${check}"\n`;
      }
      guidance += '```\n\n';
    }

    guidance += '### ⚙️ GitHub UI Configuration\n\n';
    guidance += 'In your repository settings under **Branches** → **Branch protection rules**:\n\n';
    guidance += '1. ✅ **Require status checks to pass before merging**\n';
    guidance += '2. ✅ **Require branches to be up to date before merging**\n';
    guidance += '3. Add each required check name exactly as shown above\n\n';

    if (config.requiredChecks.length > 0) {
      guidance += '**Required Check Names to Add:**\n';
      for (const check of config.requiredChecks) {
        guidance += `- \`${check}\`\n`;
      }
      guidance += '\n';
    }

    guidance += '## Optional Checks\n\n';
    guidance += 'These checks provide valuable feedback but **should NOT** be required (they may block PRs unnecessarily):\n\n';
    
    if (config.optionalChecks.length > 0) {
      for (const check of config.optionalChecks) {
        guidance += `- 📝 \`${check}\`\n`;
      }
      guidance += '\n';
    }

    if (config.conditionalChecks.length > 0) {
      guidance += '**Conditional Checks** (run only in specific circumstances):\n';
      for (const check of config.conditionalChecks) {
        guidance += `- ⚠️ \`${check}\`\n`;
      }
      guidance += '\n';
    }

    if (config.experimentalChecks.length > 0) {
      guidance += '**Experimental Checks** (not production-ready):\n';
      for (const check of config.experimentalChecks) {
        guidance += `- 🧪 \`${check}\`\n`;
      }
      guidance += '\n';
    }

    return guidance;
  }

  /**
   * Generate required checks policy documentation
   */
  generateRequiredChecksPolicy(): string {
    let policy = '# 📋 Required Checks Policy\n\n';
    
    policy += '## Overview\n\n';
    policy += 'This document defines when a GitHub Actions check becomes required for branch protection and the process for managing check lifecycle.\n\n';
    
    policy += '## Check Classification\n\n';
    policy += '### ✅ Required Checks\n';
    policy += 'Checks that **MUST** pass before code can be merged to protected branches:\n\n';
    policy += '- **Core Quality Gates**: Linting, type checking, formatting\n';
    policy += '- **Essential Tests**: Unit tests, integration tests covering critical paths\n';
    policy += '- **Security Scans**: Dependency audits, secret scanning, license checks\n';
    policy += '- **Build Verification**: Successful compilation and packaging\n\n';
    
    policy += '**Criteria for Required Status:**\n';
    policy += '- Runs on every PR without conditions\n';
    policy += '- Tests core functionality or quality standards\n';
    policy += '- Failure indicates genuine issues that should block merge\n';
    policy += '- Stable and reliable (< 2% flake rate over 30 days)\n\n';
    
    policy += '### 📝 Optional Checks\n';
    policy += 'Checks that provide valuable feedback but **should NOT** block merges:\n\n';
    policy += '- **Performance Tests**: Benchmarks, load testing\n';
    policy += '- **E2E Tests**: Complex end-to-end scenarios (may be flaky)\n';
    policy += '- **Deployment Checks**: Staging deployments, smoke tests\n';
    policy += '- **Documentation**: README updates, changelog generation\n\n';
    
    policy += '### ⚠️ Conditional Checks\n';
    policy += 'Checks that run only under specific conditions:\n\n';
    policy += '- **Path-based triggers**: Only run when relevant files change\n';
    policy += '- **Schedule-based**: Nightly builds, weekly security scans\n';
    policy += '- **Manual triggers**: workflow_dispatch events\n\n';
    
    policy += '### 🧪 Experimental Checks\n';
    policy += 'New or unstable checks in development:\n\n';
    policy += '- **Beta Features**: New testing frameworks, tools\n';
    policy += '- **Research**: Proof-of-concept validations\n';
    policy += '- **Temporary**: One-off analysis or migration checks\n\n';
    
    policy += '## Lifecycle Management\n\n';
    policy += '### Promoting Checks to Required\n\n';
    policy += 'A check can become required when it meets ALL criteria:\n\n';
    policy += '1. **Stability**: < 2% failure rate due to infrastructure issues over 30 days\n';
    policy += '2. **Relevance**: Directly impacts code quality, security, or functionality\n';
    policy += '3. **Coverage**: Runs on all relevant PRs (not path-conditional)\n';
    policy += '4. **Team Agreement**: Engineering team consensus on requirement\n';
    policy += '5. **Documentation**: Clear failure resolution guidelines\n\n';
    
    policy += '**Promotion Process:**\n';
    policy += '1. Track check stability for 30+ days\n';
    policy += '2. Document check purpose and failure resolution\n';
    policy += '3. Create team RFC for making check required\n';
    policy += '4. Update branch protection rules\n';
    policy += '5. Announce change with 1-week notice\n\n';
    
    policy += '### Deprecating Required Checks\n\n';
    policy += 'A required check should be deprecated when:\n\n';
    policy += '- **Superseded**: Replaced by better tooling or process\n';
    policy += '- **Unstable**: Consistently flaky despite improvement efforts\n';
    policy += '- **Irrelevant**: No longer validates meaningful quality criteria\n';
    policy += '- **Redundant**: Overlaps with other required checks\n\n';
    
    policy += '**Deprecation Process:**\n';
    policy += '1. Create deprecation plan with timeline\n';
    policy += '2. Add deprecation notice to check output\n';
    policy += '3. Provide alternative validation method if needed\n';
    policy += '4. Remove from required checks after 2-week notice\n';
    policy += '5. Archive or remove workflow after 30 days\n\n';
    
    policy += '## Current Required Checks\n\n';
    
    const config = this.generateBranchProtectionConfig();
    if (config.requiredChecks.length > 0) {
      policy += 'Based on current workflow analysis:\n\n';
      for (const check of config.requiredChecks) {
        policy += `- \`${check}\`\n`;
      }
    } else {
      policy += '*No checks currently meet the criteria for required status.*\n';
    }
    
    policy += '\n## Monitoring and Review\n\n';
    policy += '- **Weekly**: Review failed required checks for patterns\n';
    policy += '- **Monthly**: Analyze check stability and performance\n';
    policy += '- **Quarterly**: Full policy review and check classification audit\n\n';
    
    policy += '## Emergency Procedures\n\n';
    policy += '**Temporarily Bypassing Required Checks:**\n';
    policy += '1. Repository admin can override (with justification)\n';
    policy += '2. Create immediate follow-up issue for proper fix\n';
    policy += '3. Restore protection within 24 hours\n\n';
    
    policy += '**Incident Response:**\n';
    policy += '1. If required check blocks critical fixes, temporarily remove requirement\n';
    policy += '2. Merge critical fix with admin override\n';
    policy += '3. Fix check issue and restore requirement\n';
    policy += '4. Document incident and improve check reliability\n\n';
    
    policy += '---\n\n';
    policy += '*This policy is automatically generated from workflow analysis. Last updated: ' + new Date().toISOString().split('T')[0] + '*\n';
    
    return policy;
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    console.log('🎯 Branch Protection Analysis Summary\n');
    console.log('═'.repeat(50));

    const config = this.generateBranchProtectionConfig();
    
    console.log(`\n📊 Check Distribution:`);
    console.log(`   ✅ Required:      ${config.requiredChecks.length}`);
    console.log(`   📝 Optional:      ${config.optionalChecks.length}`);
    console.log(`   ⚠️  Conditional:   ${config.conditionalChecks.length}`);
    console.log(`   🧪 Experimental:  ${config.experimentalChecks.length}`);
    
    console.log(`\n🔒 Required Checks (add to branch protection):`);
    if (config.requiredChecks.length === 0) {
      console.log('   No checks meet the criteria for required status');
    } else {
      for (const check of config.requiredChecks) {
        console.log(`   • ${check}`);
      }
    }

    console.log(`\n⚠️  Do NOT require these checks (may block PRs unnecessarily):`);
    const nonRequired = [...config.optionalChecks, ...config.conditionalChecks, ...config.experimentalChecks];
    if (nonRequired.length === 0) {
      console.log('   All checks are suitable for requiring');
    } else {
      for (const check of nonRequired) {
        console.log(`   • ${check}`);
      }
    }
    
    console.log('\n✨ Analysis complete! Check generated documentation files.\n');
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'analyze';
  
  const auditor = new BranchProtectionAuditor();
  
  try {
    switch (command) {
      case 'analyze':
      case 'audit': {
        await auditor.analyzeWorkflows();
        auditor.printSummary();
        break;
      }
      
      case 'report': {
        await auditor.analyzeWorkflows();
        console.log(auditor.generateDetailedReport());
        break;
      }
      
      case 'config': {
        await auditor.analyzeWorkflows();
        console.log(auditor.generateBranchProtectionGuidance());
        break;
      }
      
      case 'policy': {
        await auditor.analyzeWorkflows();
        console.log(auditor.generateRequiredChecksPolicy());
        break;
      }
      
      default:
        console.log('FlakeGuard Branch Protection Auditor');
        console.log('');
        console.log('Commands:');
        console.log('  analyze (default)  Analyze workflows and print summary');
        console.log('  report            Generate detailed analysis report');
        console.log('  config            Generate branch protection configuration guide');
        console.log('  policy            Generate required checks policy documentation');
        console.log('');
        console.log('Examples:');
        console.log('  branch-protection-auditor');
        console.log('  branch-protection-auditor config > BRANCH_PROTECTION.md');
        console.log('  branch-protection-auditor policy > REQUIRED_CHECKS_POLICY.md');
        process.exit(1);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Export for use as module
export { BranchProtectionAuditor };

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('branch-protection-auditor.js')) {
  main().catch(console.error);
}