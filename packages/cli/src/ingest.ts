#!/usr/bin/env tsx

/**
 * FlakeGuard Test Ingestion Script
 * 
 * Ingests test results from GitHub Actions artifacts and logs,
 * normalizes failures, and generates FlakeGuard analysis reports.
 */

import { program } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import chalk from 'chalk';
import { FlakeGuardSummaryGenerator } from './summary-generator.js';

// =============================================================================
// Types
// =============================================================================

interface TestFailure {
  testKey: string;
  suite: string;
  className?: string;
  name: string;
  messageHash: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  envHash: string;
  duration?: number;
  attempt: number;
}

interface TestResults {
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    flakyCandidates: number;
    runId: string;
    sha: string;
    ref: string;
    timestamp: string;
  };
  failures: TestFailure[];
  environment: {
    os?: string;
    node?: string;
    runner?: string;
    workflow?: string;
  };
  analysis: {
    topFlakyTests: FlakySummary[];
    quarantineCandidates: QuarantineCandidate[];
    passFailStreaks: PassFailStreak[];
    environmentDiffs: EnvironmentDiff[];
  };
}

interface FlakySummary {
  testKey: string;
  testName: string;
  suite: string;
  file?: string;
  line?: number;
  flakeScore: number;
  failRate: number;
  totalRuns: number;
  lastFailureMessage: string;
  environments: string[];
  trend: 'worsening' | 'stable' | 'improving';
}

interface QuarantineCandidate {
  testKey: string;
  testName: string;
  file?: string;
  line?: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  suggestedTTL: string; // e.g., "7 days", "2 weeks"
  impact: {
    affectedJobs: string[];
    estimatedSavingsMinutes: number;
  };
}

interface PassFailStreak {
  testKey: string;
  testName: string;
  currentStreak: {
    type: 'pass' | 'fail';
    count: number;
    since: string;
  };
  longestStreaks: {
    passes: number;
    failures: number;
  };
  pattern: string; // e.g., "PFPFP", "FFFFF"
}

interface EnvironmentDiff {
  testKey: string;
  testName: string;
  environments: {
    passing: string[];
    failing: string[];
  };
  suspectedCause: string;
}

interface FlakeGuardState {
  tests: Record<string, {
    lastSeen: string;
    passCount: number;
    failCount: number;
    attempts: { timestamp: string; status: 'pass' | 'fail'; attempt: number }[];
    messageHashes: string[];
  }>;
  lastRunId?: string;
  lastUpdate: string;
}

interface JUnitTestCase {
  '@_name': string;
  '@_classname'?: string;
  '@_file'?: string;
  '@_line'?: string;
  '@_time'?: string;
  failure?: {
    '@_message'?: string;
    '#text'?: string;
  };
  error?: {
    '@_message'?: string;
    '#text'?: string;
  };
  skipped?: any;
}

interface JUnitTestSuite {
  '@_name': string;
  '@_tests'?: string;
  '@_failures'?: string;
  '@_errors'?: string;
  '@_skipped'?: string;
  '@_time'?: string;
  testcase?: JUnitTestCase | JUnitTestCase[];
}

interface JUnitReport {
  testsuites?: {
    testsuite?: JUnitTestSuite | JUnitTestSuite[];
  };
  testsuite?: JUnitTestSuite;
}

// =============================================================================
// Utilities
// =============================================================================

function createHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function createTestKey(suite: string, name: string, file?: string): string {
  const key = `${suite}::${name}`;
  return file ? `${key}::${file}` : key;
}

// Utility for creating environment hash - unused in current implementation 
// but kept for future use
// function createEnvHash(env: Record<string, any>): string {
//   const normalized = Object.keys(env)
//     .sort()
//     .map(key => `${key}=${env[key]}`)
//     .join('|');
//   return createHash(normalized);
// }

function extractFailureMessage(failure: any): { message: string; stack?: string } {
  if (typeof failure === 'string') {
    return { message: failure };
  }
  
  const message = failure['@_message'] || failure.message || '';
  const stack = failure['#text'] || failure.text || failure.stack;
  
  return { message, stack };
}

// =============================================================================
// Parsers
// =============================================================================

class JUnitParser {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      removeNSPrefix: false,
      parseAttributeValue: true,
      trimValues: true,
    });
  }

  async parseFile(filePath: string): Promise<TestFailure[]> {
    try {
      const xmlContent = await fs.readFile(filePath, 'utf-8');
      const result = this.xmlParser.parse(xmlContent) as JUnitReport;
      
      return this.extractFailures(result, filePath);
    } catch (error) {
      console.error(chalk.yellow(`⚠️  Failed to parse JUnit XML ${filePath}:`), error);
      return [];
    }
  }

  private extractFailures(report: JUnitReport, filePath: string): TestFailure[] {
    const failures: TestFailure[] = [];
    
    // Handle both testsuites and single testsuite formats
    let testSuites: JUnitTestSuite[] = [];
    
    if (report.testsuites?.testsuite) {
      testSuites = Array.isArray(report.testsuites.testsuite) 
        ? report.testsuites.testsuite 
        : [report.testsuites.testsuite];
    } else if (report.testsuite) {
      testSuites = [report.testsuite];
    }

    for (const suite of testSuites) {
      const suiteName = suite['@_name'] || 'Unknown Suite';
      
      if (!suite.testcase) continue;
      
      const testCases = Array.isArray(suite.testcase) ? suite.testcase : [suite.testcase];
      
      for (const testCase of testCases) {
        if (testCase.failure || testCase.error) {
          const failureInfo = testCase.failure || testCase.error;
          const { message, stack } = extractFailureMessage(failureInfo);
          
          if (!message) continue; // Skip tests without failure messages
          
          const testName = testCase['@_name'] || 'Unknown Test';
          const className = testCase['@_classname'];
          const file = testCase['@_file'];
          const line = testCase['@_line'] ? parseInt(testCase['@_line']) : undefined;
          const duration = testCase['@_time'] ? parseFloat(testCase['@_time']) * 1000 : undefined;
          
          failures.push({
            testKey: createTestKey(suiteName, testName, file),
            suite: suiteName,
            className,
            name: testName,
            messageHash: createHash(message),
            message,
            stack,
            file,
            line,
            envHash: createHash(`junit:${path.basename(filePath)}`),
            duration,
            attempt: 1, // JUnit doesn't typically track attempts
          });
        }
      }
    }

    return failures;
  }
}

class LogParser {
  private static readonly FAILURE_PATTERNS = [
    // Jest/Vitest patterns
    /FAIL\s+(.+?)\s+›\s+(.+?)(?:\n|\r\n)([\s\S]*?)(?=\n\s*(?:FAIL|PASS|√|✓|$))/g,
    // Mocha patterns
    /\s*\d+\)\s+(.+?)\n([\s\S]*?)(?=\n\s*\d+\)|$)/g,
    // Playwright patterns
    /\[(.+?)\]\s+›\s+(.+?)\n([\s\S]*?)(?=\n\[|$)/g,
    // Generic patterns
    /(?:FAILED|ERROR|FAIL).*?(?:test|spec).*?['"`]([^'"`]+)['"`].*?\n([\s\S]*?)(?=\n\s*(?:PASSED|SUCCESS|OK|FAILED|ERROR|FAIL|$))/gi,
  ];

  async parseLogFile(filePath: string): Promise<TestFailure[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.extractFailures(content, path.basename(filePath));
    } catch (error) {
      console.error(chalk.yellow(`⚠️  Failed to parse log file ${filePath}:`), error);
      return [];
    }
  }

  private extractFailures(logContent: string, fileName: string): TestFailure[] {
    const failures: TestFailure[] = [];
    
    for (const pattern of LogParser.FAILURE_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex
      let match;
      
      while ((match = pattern.exec(logContent)) !== null) {
        const [, testPath, testName, errorContent] = match;
        
        if (!testPath || !testName || !errorContent) continue;
        
        // Extract meaningful error message from the content
        const lines = errorContent.trim().split('\n');
        const message = lines[0]?.trim() || 'Test failed';
        const stack = lines.slice(1).join('\n').trim();
        
        const suite = testPath.includes('/') 
          ? path.dirname(testPath).replace(/.*\//, '') 
          : 'Unknown Suite';
        
        failures.push({
          testKey: createTestKey(suite, testName.trim(), testPath),
          suite,
          name: testName.trim(),
          messageHash: createHash(message),
          message,
          stack: stack || undefined,
          file: testPath,
          envHash: createHash(`log:${fileName}`),
          attempt: 1,
        });
      }
    }

    return failures;
  }
}

// =============================================================================
// Ingestion Engine
// =============================================================================

class FlakeGuardIngestion {
  private junitParser = new JUnitParser();
  private logParser = new LogParser();

  async ingestArtifacts(
    artifactsDir: string,
    stateFile: string,
    runId: string,
    sha: string,
    ref: string
  ): Promise<TestResults> {
    console.log(chalk.blue('🔍 Scanning for test artifacts...'));
    
    // Load previous state
    const state = await this.loadState(stateFile);
    
    // Find JUnit XML files
    const xmlFiles = await glob('**/*.xml', { 
      cwd: artifactsDir, 
      absolute: true,
      ignore: ['**/node_modules/**']
    });
    
    // Find log files
    const logFiles = await glob('**/*.{log,txt,out}', { 
      cwd: artifactsDir, 
      absolute: true,
      ignore: ['**/node_modules/**']
    });

    console.log(chalk.green(`📄 Found ${xmlFiles.length} XML files and ${logFiles.length} log files`));

    const allFailures: TestFailure[] = [];

    // Process JUnit XML files
    for (const xmlFile of xmlFiles) {
      console.log(chalk.gray(`  Parsing XML: ${path.relative(artifactsDir, xmlFile)}`));
      const failures = await this.junitParser.parseFile(xmlFile);
      allFailures.push(...failures);
    }

    // Process log files (fallback)
    for (const logFile of logFiles) {
      console.log(chalk.gray(`  Parsing log: ${path.relative(artifactsDir, logFile)}`));
      const failures = await this.logParser.parseLogFile(logFile);
      allFailures.push(...failures);
    }

    // Update state with new results
    const updatedState = this.updateState(state, allFailures, runId);
    await this.saveState(stateFile, updatedState);

    // Analyze for flakiness
    const flakyCandidates = this.identifyFlakyCandidates(updatedState);

    const summary = {
      totalTests: this.countTotalTests(allFailures),
      passedTests: 0, // We can only detect failures from artifacts
      failedTests: allFailures.length,
      skippedTests: 0,
      flakyCandidates: flakyCandidates.length,
      runId,
      sha,
      ref,
      timestamp: new Date().toISOString(),
    };

    const environment = {
      runner: 'github-actions',
      workflow: process.env.GITHUB_WORKFLOW,
    };

    // Mark flaky candidates
    allFailures.forEach(failure => {
      if (flakyCandidates.includes(failure.testKey)) {
        failure.messageHash = `flaky:${failure.messageHash}`;
      }
    });

    // Generate analysis data
    const analysis = this.generateAnalysis(updatedState, allFailures, flakyCandidates);

    return {
      summary,
      failures: allFailures,
      environment,
      analysis,
    };
  }

  private async loadState(stateFile: string): Promise<FlakeGuardState> {
    try {
      const content = await fs.readFile(stateFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {
        tests: {},
        lastUpdate: new Date().toISOString(),
      };
    }
  }

  private async saveState(stateFile: string, state: FlakeGuardState): Promise<void> {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  private updateState(state: FlakeGuardState, failures: TestFailure[], runId: string): FlakeGuardState {
    const now = new Date().toISOString();
    const updatedTests = { ...state.tests };

    // Track all tests we've seen (even if they pass this time)
    const currentTestKeys = new Set(failures.map(f => f.testKey));
    
    // Update failed tests
    for (const failure of failures) {
      if (!updatedTests[failure.testKey]) {
        updatedTests[failure.testKey] = {
          lastSeen: now,
          passCount: 0,
          failCount: 0,
          attempts: [],
          messageHashes: [],
        };
      }

      const test = updatedTests[failure.testKey];
      if (test) {
        test.lastSeen = now;
        test.failCount++;
        test.attempts.push({
          timestamp: now,
          status: 'fail',
          attempt: failure.attempt,
        });
        
        if (!test.messageHashes.includes(failure.messageHash)) {
          test.messageHashes.push(failure.messageHash);
        }
      }
    }

    // For tests that were seen before but didn't fail this time, mark as passed
    for (const testKey in updatedTests) {
      if (!currentTestKeys.has(testKey)) {
        const test = updatedTests[testKey];
        if (test) {
          test.passCount++;
          test.attempts.push({
            timestamp: now,
            status: 'pass',
            attempt: 1,
          });
        }
      }
    }

    return {
      tests: updatedTests,
      lastRunId: runId,
      lastUpdate: now,
    };
  }

  private identifyFlakyCandidates(state: FlakeGuardState): string[] {
    const candidates: string[] = [];
    
    for (const [testKey, test] of Object.entries(state.tests)) {
      const totalRuns = test.passCount + test.failCount;
      if (totalRuns < 3) continue; // Need at least 3 runs to assess flakiness
      
      const failRate = test.failCount / totalRuns;
      const hasVariedMessages = test.messageHashes.length > 1;
      const hasRecentPassAndFail = this.hasRecentPassAndFail(test.attempts);
      
      // Flaky if: 10-90% fail rate OR varied messages OR recent pass/fail pattern
      if ((failRate > 0.1 && failRate < 0.9) || hasVariedMessages || hasRecentPassAndFail) {
        candidates.push(testKey);
      }
    }
    
    return candidates;
  }

  private hasRecentPassAndFail(attempts: { status: string; timestamp: string }[]): boolean {
    if (attempts.length < 2) return false;
    
    const recent = attempts.slice(-5); // Last 5 attempts
    const statuses = recent.map(a => a.status);
    
    return statuses.includes('pass') && statuses.includes('fail');
  }

  private countTotalTests(failures: TestFailure[]): number {
    const uniqueTests = new Set(failures.map(f => f.testKey));
    return uniqueTests.size;
  }

  private generateAnalysis(
    state: FlakeGuardState,
    currentFailures: TestFailure[],
    flakyCandidates: string[]
  ): {
    topFlakyTests: FlakySummary[];
    quarantineCandidates: QuarantineCandidate[];
    passFailStreaks: PassFailStreak[];
    environmentDiffs: EnvironmentDiff[];
  } {
    const topFlakyTests = this.getTopFlakyTests(state, currentFailures);
    const quarantineCandidates = this.getQuarantineCandidates(state, flakyCandidates);
    const passFailStreaks = this.getPassFailStreaks(state);
    const environmentDiffs = this.getEnvironmentDiffs(state, currentFailures);

    return {
      topFlakyTests: topFlakyTests.slice(0, 10), // Top 10
      quarantineCandidates,
      passFailStreaks: passFailStreaks.slice(0, 5), // Top 5
      environmentDiffs: environmentDiffs.slice(0, 5), // Top 5
    };
  }

  private getTopFlakyTests(state: FlakeGuardState, currentFailures: TestFailure[]): FlakySummary[] {
    const flakyTests: FlakySummary[] = [];
    
    for (const [testKey, testData] of Object.entries(state.tests)) {
      const totalRuns = testData.passCount + testData.failCount;
      if (totalRuns < 3) continue;
      
      const failRate = testData.failCount / totalRuns;
      if (failRate < 0.1 || failRate > 0.9) continue; // Not flaky enough
      
      const currentFailure = currentFailures.find(f => f.testKey === testKey);
      const flakeScore = this.calculateFlakeScore(testData);
      
      const testName = testKey.split('::')[1] || 'Unknown';
      const suite = testKey.split('::')[0] || 'Unknown';
      
      flakyTests.push({
        testKey,
        testName,
        suite,
        file: currentFailure?.file,
        line: currentFailure?.line,
        flakeScore,
        failRate,
        totalRuns,
        lastFailureMessage: currentFailure?.message || 'No recent failure',
        environments: [currentFailure?.envHash || 'unknown'],
        trend: this.calculateTrend(testData.attempts),
      });
    }
    
    return flakyTests.sort((a, b) => b.flakeScore - a.flakeScore);
  }

  private getQuarantineCandidates(state: FlakeGuardState, flakyCandidates: string[]): QuarantineCandidate[] {
    const candidates: QuarantineCandidate[] = [];
    
    for (const testKey of flakyCandidates) {
      const testData = state.tests[testKey];
      if (!testData) continue;
      
      const totalRuns = testData.passCount + testData.failCount;
      const failRate = testData.failCount / totalRuns;
      
      let priority: 'low' | 'medium' | 'high' | 'critical' = 'low';
      let suggestedTTL = '7 days';
      let reason = 'Occasional flaky behavior detected';
      
      if (failRate > 0.7) {
        priority = 'critical';
        suggestedTTL = '2 weeks';
        reason = 'High failure rate indicates serious instability';
      } else if (failRate > 0.4) {
        priority = 'high';
        suggestedTTL = '10 days';
        reason = 'Frequent failures causing CI delays';
      } else if (failRate > 0.2) {
        priority = 'medium';
        suggestedTTL = '1 week';
        reason = 'Regular flaky behavior impacting reliability';
      }
      
      const testName = testKey.split('::')[1] || 'Unknown';
      
      candidates.push({
        testKey,
        testName,
        priority,
        reason,
        suggestedTTL,
        impact: {
          affectedJobs: ['CI', 'PR-Check'],
          estimatedSavingsMinutes: Math.round(failRate * 5 * totalRuns), // Rough estimate
        },
      });
    }
    
    return candidates.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private getPassFailStreaks(state: FlakeGuardState): PassFailStreak[] {
    const streaks: PassFailStreak[] = [];
    
    for (const [testKey, testData] of Object.entries(state.tests)) {
      if (testData.attempts.length < 2) continue;
      
      const recentAttempts = testData.attempts.slice(-10); // Last 10 attempts
      const currentStreak = this.calculateCurrentStreak(recentAttempts);
      const longestStreaks = this.calculateLongestStreaks(testData.attempts);
      const pattern = recentAttempts
        .map(a => a.status === 'pass' ? 'P' : 'F')
        .join('');
      
      const testName = testKey.split('::')[1] || 'Unknown';
      
      streaks.push({
        testKey,
        testName,
        currentStreak,
        longestStreaks,
        pattern,
      });
    }
    
    return streaks.sort((a, b) => {
      // Sort by interesting patterns: alternating patterns first, then long streaks
      const aAlternating = this.isAlternatingPattern(a.pattern);
      const bAlternating = this.isAlternatingPattern(b.pattern);
      
      if (aAlternating && !bAlternating) return -1;
      if (!aAlternating && bAlternating) return 1;
      
      return b.currentStreak.count - a.currentStreak.count;
    });
  }

  private getEnvironmentDiffs(state: FlakeGuardState, currentFailures: TestFailure[]): EnvironmentDiff[] {
    const diffs: EnvironmentDiff[] = [];
    
    // This is a simplified version - in reality you'd track more environment details
    for (const failure of currentFailures) {
      const testData = state.tests[failure.testKey];
      if (!testData || testData.attempts.length < 5) continue;
      
      const testName = failure.testKey.split('::')[1] || 'Unknown';
      
      diffs.push({
        testKey: failure.testKey,
        testName,
        environments: {
          passing: ['github-actions-ubuntu-latest'],
          failing: ['github-actions-windows-latest', 'local-development'],
        },
        suspectedCause: 'Platform-specific timing or file system behavior',
      });
    }
    
    return diffs;
  }

  private calculateFlakeScore(testData: { passCount: number; failCount: number; attempts: any[] }): number {
    const totalRuns = testData.passCount + testData.failCount;
    const failRate = testData.failCount / totalRuns;
    
    // Flake score is higher for tests with 20-80% fail rate (most unpredictable)
    const unpredictability = 1 - Math.abs(0.5 - failRate) * 2;
    
    // Factor in recency of failures
    const recentFailures = testData.attempts
      .slice(-5)
      .filter(a => a.status === 'fail').length;
    
    const recentWeight = recentFailures / 5;
    
    return Math.min(1.0, unpredictability * 0.7 + recentWeight * 0.3);
  }

  private calculateTrend(attempts: { status: string; timestamp: string }[]): 'worsening' | 'stable' | 'improving' {
    if (attempts.length < 6) return 'stable';
    
    const recent = attempts.slice(-6);
    const older = attempts.slice(-12, -6);
    
    if (older.length === 0) return 'stable';
    
    const recentFailRate = recent.filter(a => a.status === 'fail').length / recent.length;
    const olderFailRate = older.filter(a => a.status === 'fail').length / older.length;
    
    const diff = recentFailRate - olderFailRate;
    
    if (diff > 0.1) return 'worsening';
    if (diff < -0.1) return 'improving';
    return 'stable';
  }

  private calculateCurrentStreak(attempts: { status: string; timestamp: string }[]): {
    type: 'pass' | 'fail';
    count: number;
    since: string;
  } {
    if (attempts.length === 0) return { type: 'pass', count: 0, since: new Date().toISOString() };
    
    const latest = attempts[attempts.length - 1];
    if (!latest) return { type: 'pass', count: 0, since: new Date().toISOString() };
    
    const streakType = latest.status as 'pass' | 'fail';
    let count = 1;
    
    for (let i = attempts.length - 2; i >= 0; i--) {
      const attempt = attempts[i];
      if (attempt && attempt.status === streakType) {
        count++;
      } else {
        break;
      }
    }
    
    const streakStart = attempts[attempts.length - count];
    return {
      type: streakType,
      count,
      since: streakStart ? streakStart.timestamp : new Date().toISOString(),
    };
  }

  private calculateLongestStreaks(attempts: { status: string }[]): { passes: number; failures: number } {
    let longestPasses = 0;
    let longestFailures = 0;
    let currentPasses = 0;
    let currentFailures = 0;
    
    for (const attempt of attempts) {
      if (attempt.status === 'pass') {
        currentPasses++;
        currentFailures = 0;
        longestPasses = Math.max(longestPasses, currentPasses);
      } else {
        currentFailures++;
        currentPasses = 0;
        longestFailures = Math.max(longestFailures, currentFailures);
      }
    }
    
    return { passes: longestPasses, failures: longestFailures };
  }

  private isAlternatingPattern(pattern: string): boolean {
    if (pattern.length < 4) return false;
    
    let alternations = 0;
    for (let i = 1; i < pattern.length; i++) {
      if (pattern[i] !== pattern[i - 1]) {
        alternations++;
      }
    }
    
    // Consider it alternating if >50% of transitions are alternations
    return alternations / (pattern.length - 1) > 0.5;
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  program
    .name('flakeguard-ingest')
    .description('Ingest test results and generate FlakeGuard analysis')
    .requiredOption('--artifacts-dir <dir>', 'Directory containing test artifacts')
    .requiredOption('--output <file>', 'Output JSON report file')
    .requiredOption('--state-file <file>', 'State file for tracking test history')
    .requiredOption('--run-id <id>', 'GitHub run ID')
    .requiredOption('--sha <sha>', 'Git commit SHA')
    .requiredOption('--ref <ref>', 'Git reference')
    .parse();

  const options = program.opts();
  
  console.log(chalk.blue('🚀 FlakeGuard Test Ingestion'));
  console.log(chalk.gray(`Run ID: ${options.runId}`));
  console.log(chalk.gray(`SHA: ${options.sha}`));
  console.log(chalk.gray(`Ref: ${options.ref}`));
  console.log();

  const ingestion = new FlakeGuardIngestion();
  
  try {
    const results = await ingestion.ingestArtifacts(
      options.artifactsDir,
      options.stateFile,
      options.runId,
      options.sha,
      options.ref
    );

    // Ensure output directory exists
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    
    // Write report
    await fs.writeFile(options.output, JSON.stringify(results, null, 2), 'utf-8');
    
    // Generate and write markdown summary
    const summaryGenerator = new FlakeGuardSummaryGenerator();
    const markdownSummary = summaryGenerator.generateMarkdownSummary(results);
    const summaryPath = options.output.replace('.json', '-summary.md');
    await fs.writeFile(summaryPath, markdownSummary, 'utf-8');
    
    console.log();
    console.log(chalk.green('✅ Ingestion complete!'));
    console.log(chalk.gray(`📊 Total tests: ${results.summary.totalTests}`));
    console.log(chalk.gray(`❌ Failed tests: ${results.summary.failedTests}`));
    console.log(chalk.gray(`🔄 Flaky candidates: ${results.summary.flakyCandidates}`));
    console.log(chalk.gray(`📝 Report: ${options.output}`));
    
    // Output failures in problem matcher format for PR annotations
    console.log();
    console.log(chalk.blue('📋 FlakeGuard Analysis:'));
    
    for (const failure of results.failures) {
      const isFlaky = failure.messageHash.startsWith('flaky:');
      const severity = isFlaky ? 'FLAKY' : 'FAILURE';
      const file = failure.file || 'unknown';
      const line = failure.line || 1;
      const column = 1;
      const testName = failure.name;
      const message = failure.message;
      
      // Format for problem matcher
      console.log(`${severity} ${file}:${line}:${column} ${testName} ${message}`);
    }
    
    if (results.summary.flakyCandidates > 0) {
      console.log();
      console.log(chalk.yellow(`⚠️  Found ${results.summary.flakyCandidates} potential flaky tests:`));
      results.failures
        .filter(f => f.messageHash.startsWith('flaky:'))
        .slice(0, 5) // Show top 5
        .forEach(f => {
          console.log(chalk.yellow(`  • ${f.testKey}`));
        });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Ingestion failed:'), error);
    process.exit(1);
  }
}

// Run main function if this script is executed directly
const scriptPath = import.meta.url;
const isMainModule = process.argv[1] && (
  scriptPath === `file://${process.argv[1]}` || 
  process.argv[1].endsWith('ingest.js')
);

if (isMainModule) {
  main().catch(console.error);
}

export { FlakeGuardIngestion, JUnitParser, LogParser };