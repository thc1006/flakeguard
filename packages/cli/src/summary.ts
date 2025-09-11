#!/usr/bin/env node

/**
 * FlakeGuard Job Summary Generator
 * 
 * Generates rich Markdown reports for GitHub Actions $GITHUB_STEP_SUMMARY
 * Analyzes test results, quarantine status, and environmental factors.
 */

import { Command } from 'commander';
import { readFile, appendFile } from 'fs/promises';
import { QuarantineValidator } from './quarantine-validator.js';

// Data interfaces
interface TestReport {
  timestamp: string;
  runId: string;
  sha: string;
  ref: string;
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    flakyCandidates: number;
    quarantinedTests: number;
  };
  failures: TestFailure[];
  environments: EnvironmentInfo[];
  metadata: {
    duration: number;
    retryAttempts: number;
    lastRunTime: string;
  };
}

interface TestFailure {
  testKey: string;
  name: string;
  file: string;
  line?: number;
  message: string;
  stack?: string;
  environment: string;
  frequency: number;
  volatility: number;
  firstSeen: string;
  lastSeen: string;
  attempts: number;
  isFlaky: boolean;
  isQuarantined: boolean;
}

interface EnvironmentInfo {
  id: string;
  os: string;
  nodeVersion: string;
  arch: string;
  runner: string;
  failureCount: number;
  totalTests: number;
  failureRate: number;
}

interface QuarantineCandidate {
  testKey: string;
  reason: string;
  ownerTeam: string;
  quarantinedAt: string;
  expiresAt: string;
  daysRemaining: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
}

interface SummaryData {
  topFlakes: TestFailure[];
  quarantineCandidates: QuarantineCandidate[];
  environmentDeltas: EnvironmentInfo[];
  overallStatus: 'green' | 'yellow' | 'red';
  recommendations: string[];
}

class FlakeGuardSummaryGenerator {
  
  /**
   * Load and parse test report data
   */
  async loadTestReport(reportPath: string): Promise<TestReport | null> {
    try {
      const reportData = await readFile(reportPath, 'utf-8');
      return JSON.parse(reportData) as TestReport;
    } catch (error) {
      console.warn(`Warning: Could not load test report from ${reportPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Load and parse quarantine configuration
   */
  async loadQuarantineData(configPath: string): Promise<QuarantineCandidate[]> {
    try {
      const validator = new QuarantineValidator();
      const result = await validator.validateFile(configPath);
      
      if (!result.isValid || !result.config) {
        return [];
      }

      const now = new Date();
      return result.config.quarantined_tests.map((entry: any) => {
        const expiresAt = new Date(entry.expires_at);
        const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        
        return {
          testKey: entry.test_key,
          reason: entry.reason,
          ownerTeam: entry.owner_team,
          quarantinedAt: entry.quarantined_at,
          expiresAt: entry.expires_at,
          daysRemaining,
          priority: entry.priority,
          notes: entry.notes
        };
      });
    } catch (error) {
      console.warn(`Warning: Could not load quarantine data from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Analyze test data and generate summary insights
   */
  analyzeSummaryData(report: TestReport | null, quarantined: QuarantineCandidate[]): SummaryData {
    const topFlakes = this.getTopFlakes(report?.failures || [], 5);
    const environmentDeltas = this.analyzeEnvironmentDeltas(report?.environments || []);
    const overallStatus = this.determineOverallStatus(report, quarantined);
    const recommendations = this.generateRecommendations(report, quarantined, topFlakes);

    return {
      topFlakes,
      quarantineCandidates: quarantined,
      environmentDeltas,
      overallStatus,
      recommendations
    };
  }

  /**
   * Get top N flaky test signatures by frequency and volatility
   */
  private getTopFlakes(failures: TestFailure[], limit: number): TestFailure[] {
    return failures
      .filter(f => f.isFlaky)
      .sort((a, b) => {
        // Sort by frequency * volatility score
        const scoreA = a.frequency * a.volatility;
        const scoreB = b.frequency * b.volatility;
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * Analyze environment deltas that correlate with failures
   */
  private analyzeEnvironmentDeltas(environments: EnvironmentInfo[]): EnvironmentInfo[] {
    return environments
      .filter(env => env.failureRate > 0)
      .sort((a, b) => b.failureRate - a.failureRate)
      .slice(0, 3); // Top 3 problematic environments
  }

  /**
   * Determine overall health status
   */
  private determineOverallStatus(report: TestReport | null, quarantined: QuarantineCandidate[]): 'green' | 'yellow' | 'red' {
    if (!report) return 'yellow';

    const { failedTests, flakyCandidates } = report.summary;
    const unquarantinedFailures = failedTests - quarantined.length;
    const expiredQuarantines = quarantined.filter(q => q.daysRemaining <= 0).length;

    if (unquarantinedFailures === 0 && expiredQuarantines === 0) {
      return 'green'; // All failures are quarantined and within TTL
    } else if (flakyCandidates > failedTests * 0.5) {
      return 'yellow'; // Mostly flaky failures
    } else {
      return 'red'; // Significant deterministic failures
    }
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(report: TestReport | null, quarantined: QuarantineCandidate[], topFlakes: TestFailure[]): string[] {
    const recommendations: string[] = [];

    if (!report) {
      recommendations.push("⚠️ No test report available - ensure FlakeGuard ingestion is working correctly");
      return recommendations;
    }

    // Quarantine recommendations
    const expiredQuarantines = quarantined.filter(q => q.daysRemaining <= 0);
    if (expiredQuarantines.length > 0) {
      recommendations.push(`🔄 **${expiredQuarantines.length} quarantined tests have expired** - review and fix or extend quarantine`);
    }

    const expiringSoon = quarantined.filter(q => q.daysRemaining > 0 && q.daysRemaining <= 3);
    if (expiringSoon.length > 0) {
      recommendations.push(`⏰ **${expiringSoon.length} quarantined tests expire in ≤3 days** - prepare fixes or extend quarantine`);
    }

    // Flake recommendations
    if (topFlakes.length > 0) {
      const highVolatilityFlakes = topFlakes.filter(f => f.volatility > 0.7);
      if (highVolatilityFlakes.length > 0) {
        recommendations.push(`🎯 **Focus on ${highVolatilityFlakes.length} high-volatility flakes** - these impact CI reliability most`);
      }
    }

    // Environment recommendations
    if (report.environments.some(env => env.failureRate > 0.3)) {
      recommendations.push("🖥️ **Environment-specific failures detected** - consider testing matrix adjustments");
    }

    // General recommendations
    if (report.summary.flakyCandidates > report.summary.failedTests * 0.8) {
      recommendations.push("✨ **Most failures appear flaky** - consider auto-quarantine policies for known patterns");
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ **Test suite is stable** - no immediate action required");
    }

    return recommendations;
  }

  /**
   * Generate rich Markdown summary
   */
  generateMarkdownSummary(data: SummaryData, report: TestReport | null, options: { 
    commitSha?: string; 
    runId?: string; 
    artifactUrls?: string[];
  }): string {
    const timestamp = new Date().toISOString();
    const statusEmoji = {
      green: '✅',
      yellow: '⚠️',
      red: '❌'
    }[data.overallStatus];

    let markdown = `# ${statusEmoji} FlakeGuard Test Analysis Summary\n\n`;
    
    // Metadata section
    markdown += `**Generated:** ${timestamp}\n`;
    if (options.commitSha) {
      markdown += `**Commit:** \`${options.commitSha.substring(0, 8)}\`\n`;
    }
    if (options.runId) {
      markdown += `**Run ID:** ${options.runId}\n`;
    }
    markdown += `**Status:** ${data.overallStatus.toUpperCase()}\n\n`;

    // Overall metrics
    if (report) {
      markdown += `## 📊 Test Metrics\n\n`;
      markdown += `| Metric | Count | Percentage |\n`;
      markdown += `|--------|-------|------------|\n`;
      markdown += `| **Total Tests** | ${report.summary.totalTests} | 100% |\n`;
      markdown += `| **Passed** | ${report.summary.passedTests} | ${((report.summary.passedTests / report.summary.totalTests) * 100).toFixed(1)}% |\n`;
      markdown += `| **Failed** | ${report.summary.failedTests} | ${((report.summary.failedTests / report.summary.totalTests) * 100).toFixed(1)}% |\n`;
      markdown += `| **Flaky Candidates** | ${report.summary.flakyCandidates} | ${((report.summary.flakyCandidates / report.summary.totalTests) * 100).toFixed(1)}% |\n`;
      markdown += `| **Quarantined** | ${report.summary.quarantinedTests} | ${((report.summary.quarantinedTests / report.summary.totalTests) * 100).toFixed(1)}% |\n\n`;
    }

    // Top flaky tests
    if (data.topFlakes.length > 0) {
      markdown += `## 🎯 Top Flaky Tests (by Impact)\n\n`;
      markdown += `| Test | File | Frequency | Volatility | Last Seen |\n`;
      markdown += `|------|------|-----------|------------|------------|\n`;
      data.topFlakes.forEach(flake => {
        const volatilityBadge = flake.volatility > 0.8 ? '🔴' : flake.volatility > 0.5 ? '🟡' : '🟢';
        markdown += `| \`${flake.name}\` | [\`${flake.file}\`](/${flake.file}#L${flake.line || 1}) | ${flake.frequency}x | ${volatilityBadge} ${(flake.volatility * 100).toFixed(0)}% | ${new Date(flake.lastSeen).toLocaleDateString()} |\n`;
      });
      markdown += '\n';
    }

    // Quarantine status
    if (data.quarantineCandidates.length > 0) {
      markdown += `## 🔒 Quarantine Status\n\n`;
      
      const active = data.quarantineCandidates.filter(q => q.daysRemaining > 0);
      const expired = data.quarantineCandidates.filter(q => q.daysRemaining <= 0);
      
      if (active.length > 0) {
        markdown += `### Active Quarantines (${active.length})\n\n`;
        markdown += `| Test | Owner | Days Remaining | Priority | Reason |\n`;
        markdown += `|------|-------|----------------|----------|--------|\n`;
        active.forEach(q => {
          const priorityBadge = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '🟢'
          }[q.priority];
          const daysColor = q.daysRemaining <= 3 ? '🔴' : q.daysRemaining <= 7 ? '🟡' : '🟢';
          markdown += `| \`${q.testKey}\` | @${q.ownerTeam} | ${daysColor} ${q.daysRemaining}d | ${priorityBadge} ${q.priority} | ${q.reason} |\n`;
        });
        markdown += '\n';
      }

      if (expired.length > 0) {
        markdown += `### ⚠️ Expired Quarantines (${expired.length})\n\n`;
        markdown += `| Test | Owner | Expired | Priority | Action Required |\n`;
        markdown += `|------|-------|---------|----------|------------------|\n`;
        expired.forEach(q => {
          const priorityBadge = {
            critical: '🔴',
            high: '🟠', 
            medium: '🟡',
            low: '🟢'
          }[q.priority];
          markdown += `| \`${q.testKey}\` | @${q.ownerTeam} | ${Math.abs(q.daysRemaining)}d ago | ${priorityBadge} ${q.priority} | Fix or extend quarantine |\n`;
        });
        markdown += '\n';
      }
    }

    // Environment analysis
    if (data.environmentDeltas.length > 0) {
      markdown += `## 🖥️ Environment Analysis\n\n`;
      markdown += `| Environment | OS | Node | Arch | Failure Rate | Tests |\n`;
      markdown += `|-------------|----|----- |------|--------------|-------|\n`;
      data.environmentDeltas.forEach(env => {
        const rateColor = env.failureRate > 0.5 ? '🔴' : env.failureRate > 0.2 ? '🟡' : '🟢';
        markdown += `| ${env.runner} | ${env.os} | ${env.nodeVersion} | ${env.arch} | ${rateColor} ${(env.failureRate * 100).toFixed(1)}% | ${env.failureCount}/${env.totalTests} |\n`;
      });
      markdown += '\n';
    }

    // Governance section (linked to PR comments)
    if (options.runId) {
      markdown += `## 🛡️ Governance & Ownership\n\n`;
      markdown += `**Quarantine Management:** [View governance report and owner assignments](${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || 'repo'}/pull/${process.env.GITHUB_EVENT_NUMBER || 'N/A'}#issuecomment-quarantine-governance)\n\n`;
      
      // Quick governance stats
      const activeQuarantines = data.quarantineCandidates.filter(q => q.daysRemaining > 0).length;
      const expiredQuarantines = data.quarantineCandidates.filter(q => q.daysRemaining <= 0).length;
      const expiringSoon = data.quarantineCandidates.filter(q => q.daysRemaining > 0 && q.daysRemaining <= 7).length;
      
      markdown += `| Governance Status | Count | Action Required |\n`;
      markdown += `|-------------------|-------|------------------|\n`;
      markdown += `| 🔒 Active Quarantines | ${activeQuarantines} | Monitor progress |\n`;
      
      if (expiringSoon > 0) {
        markdown += `| ⏰ Expiring Soon (≤7d) | ${expiringSoon} | **Prepare fixes or extend** |\n`;
      }
      
      if (expiredQuarantines > 0) {
        markdown += `| 🔴 Expired Quarantines | ${expiredQuarantines} | **Immediate action required** |\n`;
      }
      
      const unquarantinedFailures = report ? report.failures.filter(f => !f.isQuarantined).length : 0;
      if (unquarantinedFailures > 0) {
        markdown += `| 🚨 Unquarantined Failures | ${unquarantinedFailures} | **Review for quarantine** |\n`;
      }
      
      markdown += '\n';
      
      // Add governance quick actions
      if (expiredQuarantines > 0 || expiringSoon > 0 || unquarantinedFailures > 0) {
        markdown += `### 🎯 Quick Actions\n\n`;
        
        if (expiredQuarantines > 0) {
          markdown += `- **Clean up expired quarantines:** \`pnpm --filter @flakeguard/cli exec tsx src/quarantine-governor.ts cleanup\`\n`;
        }
        
        if (unquarantinedFailures > 0) {
          markdown += `- **Generate PR governance comment:** \`pnpm --filter @flakeguard/cli exec tsx src/quarantine-governor.ts report\`\n`;
        }
        
        markdown += `- **Validate quarantine config:** \`pnpm --filter @flakeguard/cli exec tsx src/quarantine-governor.ts validate\`\n`;
        markdown += '\n';
      }
    }

    // Recommendations
    if (data.recommendations.length > 0) {
      markdown += `## 💡 Recommendations\n\n`;
      data.recommendations.forEach(rec => {
        markdown += `- ${rec}\n`;
      });
      markdown += '\n';
    }

    // Artifacts and links
    if (options.artifactUrls && options.artifactUrls.length > 0) {
      markdown += `## 📎 Artifacts & Logs\n\n`;
      options.artifactUrls.forEach(url => {
        const name = url.split('/').pop() || 'Artifact';
        markdown += `- [${name}](${url})\n`;
      });
      markdown += '\n';
    }

    // Footer
    markdown += `---\n`;
    markdown += `*FlakeGuard v1.0.0 - Automated flaky test detection and quarantine management*\n`;

    return markdown;
  }

  /**
   * Append summary to GitHub step summary
   */
  async publishToGitHubSummary(markdown: string, summaryFile?: string): Promise<void> {
    const targetFile = summaryFile || process.env.GITHUB_STEP_SUMMARY;
    
    if (!targetFile) {
      console.warn('Warning: GITHUB_STEP_SUMMARY not set, writing to stdout instead');
      console.log('\n' + markdown);
      return;
    }

    try {
      await appendFile(targetFile, '\n' + markdown);
      console.log(`✅ FlakeGuard summary published to ${targetFile}`);
    } catch (error) {
      console.error(`❌ Failed to write summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Fallback to stdout
      console.log('\n' + markdown);
    }
  }
}

// CLI Commands
async function generateSummaryCommand(options: {
  report?: string;
  quarantine?: string;
  output?: string;
  sha?: string;
  runId?: string;
  artifacts?: string;
}) {
  const generator = new FlakeGuardSummaryGenerator();
  
  const reportPath = options.report || '.flakeguard/out/report.json';
  const quarantinePath = options.quarantine || '.flakeguard/quarantine.yml';
  
  console.log('📊 Generating FlakeGuard summary...');
  console.log(`  Report: ${reportPath}`);
  console.log(`  Quarantine: ${quarantinePath}`);

  try {
    // Load data
    const [report, quarantined] = await Promise.all([
      generator.loadTestReport(reportPath),
      generator.loadQuarantineData(quarantinePath)
    ]);

    // Analyze
    const summaryData = generator.analyzeSummaryData(report, quarantined);
    
    // Generate markdown
    const artifactUrls = options.artifacts ? options.artifacts.split(',') : [];
    const markdown = generator.generateMarkdownSummary(summaryData, report, {
      commitSha: options.sha,
      runId: options.runId,
      artifactUrls
    });

    // Publish
    if (options.output) {
      await generator.publishToGitHubSummary(markdown, options.output);
    } else {
      await generator.publishToGitHubSummary(markdown);
    }

    // Log key metrics
    console.log('\n📈 Summary Metrics:');
    console.log(`  Status: ${summaryData.overallStatus.toUpperCase()}`);
    console.log(`  Top Flakes: ${summaryData.topFlakes.length}`);
    console.log(`  Quarantined: ${summaryData.quarantineCandidates.length}`);
    console.log(`  Recommendations: ${summaryData.recommendations.length}`);

  } catch (error) {
    console.error(`❌ Summary generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// CLI Setup
const program = new Command();

program
  .name('flakeguard-summary')
  .description('FlakeGuard Job Summary Generator for GitHub Actions')
  .version('1.0.0');

program
  .command('generate')
  .description('Generate FlakeGuard summary and publish to GitHub Actions')
  .option('-r, --report <path>', 'Path to test report JSON file', '.flakeguard/out/report.json')
  .option('-q, --quarantine <path>', 'Path to quarantine config file', '.flakeguard/quarantine.yml')
  .option('-o, --output <path>', 'Output file path (defaults to $GITHUB_STEP_SUMMARY)')
  .option('--sha <sha>', 'Git commit SHA')
  .option('--run-id <id>', 'GitHub Actions run ID')
  .option('--artifacts <urls>', 'Comma-separated list of artifact URLs')
  .action(generateSummaryCommand);

// Parse CLI arguments or show help
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export { FlakeGuardSummaryGenerator, TestReport, TestFailure, QuarantineCandidate, SummaryData };