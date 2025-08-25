/**
 * Comprehensive Test Suite for Check Run Renderer
 * 
 * Tests all aspects of the FlakeGuard P4 Check Run rendering system:
 * - Output formatting and markdown generation
 * - Action selection and GitHub 3-action constraint
 * - File link generation and edge cases
 * - Severity calculation and emoji indicators
 * - Integration with FlakeScore and stability metrics
 */

import type {
  FlakeScore,
  FlakeFeatures,
  QuarantineRecommendation,
  TestStabilityMetrics,
  MessageSignature,
  FailureCluster,
} from '@flakeguard/shared';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  renderCheckRunOutput,
  formatTestName,
  generateFileLink,
  selectTopActions,
  calculateSeverity,
  convertFlakeScoresToTests,
  convertStabilityMetricsToTests,
  type TestWithLocation,
  type Repository,
  type CheckRunOutput,
  type SeverityLevel,
} from '../check-run-renderer.js';

describe('Check Run Renderer', () => {
  let mockRepository: Repository;
  let sampleTests: TestWithLocation[];

  beforeEach(() => {
    mockRepository = {
      owner: 'test-org',
      repo: 'test-repo',
      defaultBranch: 'main',
    };

    sampleTests = [
      {
        testName: 'integration.test.DatabaseConnection',
        failCount: 5,
        rerunPassRate: 0.75,
        lastFailedRun: '2024-01-15T10:30:00Z',
        confidence: 0.85,
        totalRuns: 20,
        file: 'src/tests/integration/database.test.ts',
        line: 42,
        flakeScore: 0.85,
      },
      {
        testName: 'unit.test.AsyncOperation',
        failCount: 3,
        rerunPassRate: 0.88,
        lastFailedRun: '2024-01-14T15:45:30Z',
        confidence: 0.60,
        totalRuns: 15,
        file: 'src/utils/async.test.ts',
        line: 23,
        flakeScore: 0.60,
      },
    ];
  });

  describe('renderCheckRunOutput', () => {
    it('should render empty state correctly', () => {
      const output = renderCheckRunOutput([], mockRepository);
      
      expect(output.title).toBe('✅ FlakeGuard Analysis Complete');
      expect(output.summary).toContain('No flaky test candidates detected');
      expect(output.summary).toContain('All tests appear to be stable');
      expect(output.actions).toHaveLength(0);
    });

    it('should render single test candidate with file link', () => {
      const singleTest: TestWithLocation[] = [
        {
          testName: 'integration.test.VeryLongTestNameThatShouldBeTruncatedBecauseItExceeds50Chars',
          failCount: 5,
          rerunPassRate: 0.75,
          lastFailedRun: '2024-01-15T10:30:00Z',
          confidence: 0.85,
          totalRuns: 20,
          file: 'src/tests/integration/database.test.ts',
          line: 42,
          flakeScore: 0.90, // Critical level
        },
      ];

      const output = renderCheckRunOutput(singleTest, mockRepository);
      
      expect(output.title).toBe('🔍 FlakeGuard Analysis: 1 Flaky Test Candidate Detected');
      expect(output.summary).toContain('## Flaky Test Candidates');
      expect(output.summary).toContain('| Test Name | Fail Count | Rerun Pass Rate | Last Failed Run | Severity |');
      
      // Check file link generation
      const expectedLink = 'https://github.com/test-org/test-repo/blob/main/src/tests/integration/database.test.ts#L42';
      expect(output.summary).toContain(expectedLink);
      
      // Check truncation (50 chars + "..." = 53, but we show 47 + "...")
      expect(output.summary).toContain('integration.test.VeryLongTestNameThatShouldBe...');
      
      // Check critical severity
      expect(output.summary).toContain('🔴 Critical');
      
      // Check date formatting
      expect(output.summary).toContain('1/15/2024');
    });

    it('should handle tests without file information', () => {
      const testWithoutFile: TestWithLocation[] = [
        {
          testName: 'some.test.NoFileInfo',
          failCount: 2,
          rerunPassRate: 0.90,
          lastFailedRun: null,
          confidence: 0.40,
          totalRuns: 10,
          flakeScore: 0.40,
        },
      ];

      const output = renderCheckRunOutput(testWithoutFile, mockRepository);
      
      // Should use backticks instead of links
      expect(output.summary).toContain('`some.test.NoFileInfo`');
      expect(output.summary).not.toContain('https://github.com');
      expect(output.summary).toContain('N/A'); // No last failed run
      expect(output.summary).toContain('🟢 Stable'); // Low severity
    });

    it('should sort tests by confidence and flake score', () => {
      const unsortedTests: TestWithLocation[] = [
        {
          testName: 'test.LowConfidence',
          failCount: 2,
          rerunPassRate: 0.9,
          lastFailedRun: null,
          confidence: 0.3,
          totalRuns: 10,
          flakeScore: 0.3,
        },
        {
          testName: 'test.HighConfidence',
          failCount: 8,
          rerunPassRate: 0.6,
          lastFailedRun: '2024-01-15T10:00:00Z',
          confidence: 0.9,
          totalRuns: 15,
          flakeScore: 0.9,
        },
        {
          testName: 'test.MediumConfidence',
          failCount: 4,
          rerunPassRate: 0.8,
          lastFailedRun: null,
          confidence: 0.6,
          totalRuns: 12,
          flakeScore: 0.6,
        },
      ];

      const output = renderCheckRunOutput(unsortedTests, mockRepository);
      
      const summaryLines = output.summary.split('\n');
      const testRows = summaryLines.filter(line => line.includes('`test.'));
      
      // Should be sorted by confidence: High (0.9), Medium (0.6), Low (0.3)
      expect(testRows[0]).toContain('test.HighConfidence');
      expect(testRows[1]).toContain('test.MediumConfidence');
      expect(testRows[2]).toContain('test.LowConfidence');
    });

    it('should limit display to 20 tests and show overflow message', () => {
      const manyTests: TestWithLocation[] = Array.from({ length: 30 }, (_, i) => ({
        testName: `test.Candidate${i + 1}`,
        failCount: 30 - i, // Descending order
        rerunPassRate: 0.7,
        lastFailedRun: null,
        confidence: 0.5,
        totalRuns: 20,
        flakeScore: 0.5,
      }));

      const output = renderCheckRunOutput(manyTests, mockRepository);
      
      // Should show overflow message
      expect(output.summary).toContain('*Showing top 20 of 30 total candidates.*');
      
      // Count actual test rows in table
      const summaryLines = output.summary.split('\n');
      const testRows = summaryLines.filter(line => line.includes('`test.Candidate'));
      expect(testRows).toHaveLength(20);
    });

    it('should include severity legend and explanations', () => {
      const output = renderCheckRunOutput(sampleTests, mockRepository);
      
      expect(output.summary).toContain('### Severity Levels');
      expect(output.summary).toContain('🔴 **Critical** - High confidence flaky tests');
      expect(output.summary).toContain('🟡 **Warning** - Moderate confidence tests');
      expect(output.summary).toContain('🟢 **Stable** - Low confidence, likely not flaky');
      
      expect(output.summary).toContain('### Understanding Flaky Tests');
      expect(output.summary).toContain('**Timing Issues**');
      expect(output.summary).toContain('**External Dependencies**');
      expect(output.summary).toContain('**Resource Constraints**');
      expect(output.summary).toContain('**Environment Factors**');
      
      expect(output.summary).toContain('### Recommended Actions');
      expect(output.summary).toContain('*Analysis generated by FlakeGuard');
    });

    it('should include action-specific recommendations', () => {
      const criticalAndWarningTests: TestWithLocation[] = [
        { ...sampleTests[0], flakeScore: 0.9, confidence: 0.9 }, // Critical
        { ...sampleTests[1], flakeScore: 0.6, confidence: 0.6 }, // Warning
      ];

      const output = renderCheckRunOutput(criticalAndWarningTests, mockRepository);
      
      expect(output.summary).toContain('**Quarantine 1 critical test** to prevent CI instability');
      expect(output.summary).toContain('**Investigate 1 warning test** for potential improvements');
    });

    it('should generate appropriate actions', () => {
      const output = renderCheckRunOutput(sampleTests, mockRepository);
      
      expect(output.actions).toHaveLength(3);
      expect(output.actions.some(a => a.identifier === 'quarantine')).toBe(true);
      expect(output.actions.some(a => a.identifier === 'rerun_failed')).toBe(true);
      expect(output.actions.some(a => a.identifier === 'open_issue')).toBe(true);
    });
  });

  describe('formatTestName', () => {
    it('should truncate long test names to 50 characters', () => {
      const longName = 'com.example.integration.DatabaseConnectionPoolTest.testConnectionTimeoutHandling';
      const formatted = formatTestName(longName);
      
      expect(formatted.length).toBeLessThanOrEqual(50);
      expect(formatted).toBe('com.example.integration.DatabaseConnectionPo...');
    });

    it('should escape markdown special characters', () => {
      const nameWithSpecialChars = 'test_with_underscores[param*value]{data}.method';
      const formatted = formatTestName(nameWithSpecialChars);
      
      expect(formatted).toBe('test_with_underscores\\\[param\\*value\\]\\{data\\}\\.method');
    });

    it('should handle empty or null names gracefully', () => {
      expect(formatTestName('')).toBe('Unknown Test');
      expect(formatTestName(null as any)).toBe('Unknown Test');
      expect(formatTestName(undefined as any)).toBe('Unknown Test');
    });

    it('should leave short names unchanged', () => {
      const shortName = 'simple.test';
      const formatted = formatTestName(shortName);
      
      expect(formatted).toBe('simple.test');
    });
  });

  describe('generateFileLink', () => {
    it('should generate correct GitHub permalinks', () => {
      const link = generateFileLink('src/tests/example.test.ts', 42, mockRepository);
      
      expect(link).toBe('https://github.com/test-org/test-repo/blob/main/src/tests/example.test.ts#L42');
    });

    it('should use specified default branch', () => {
      const repoWithBranch = { ...mockRepository, defaultBranch: 'develop' };
      const link = generateFileLink('test.ts', 10, repoWithBranch);
      
      expect(link).toContain('/blob/develop/');
    });

    it('should handle relative paths', () => {
      const link = generateFileLink('./src/components/Button.test.tsx', 25, mockRepository);
      
      expect(link).toBe('https://github.com/test-org/test-repo/blob/main/src/components/Button.test.tsx#L25');
    });

    it('should default to main branch when not specified', () => {
      const repoWithoutBranch = { owner: 'test-org', repo: 'test-repo' };
      const link = generateFileLink('test.ts', 1, repoWithoutBranch);
      
      expect(link).toContain('/blob/main/');
    });
  });

  describe('selectTopActions', () => {
    it('should never exceed 3 actions', () => {
      // Create scenario that might generate many actions
      const manyProblematicTests: TestWithLocation[] = Array.from({ length: 20 }, (_, i) => ({
        testName: `test${i}`,
        failCount: 10,
        rerunPassRate: 0.5,
        lastFailedRun: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(), // Recent failures
        confidence: 0.95, // All critical
        totalRuns: 20,
        flakeScore: 0.95,
      }));

      const actions = selectTopActions(manyProblematicTests);
      
      expect(actions.length).toBeLessThanOrEqual(3);
      expect(actions.length).toBeGreaterThan(0);
      
      // Verify all actions have required properties
      actions.forEach(action => {
        expect(action.identifier).toBeDefined();
        expect(action.label).toBeDefined();
        expect(action.description).toBeDefined();
      });
    });

    it('should prioritize quarantine for critical tests', () => {
      const criticalTests: TestWithLocation[] = [
        {
          testName: 'test.Critical',
          failCount: 8,
          rerunPassRate: 0.4,
          lastFailedRun: new Date().toISOString(),
          confidence: 0.9,
          totalRuns: 20,
          flakeScore: 0.9, // Critical
        },
      ];

      const actions = selectTopActions(criticalTests);
      
      expect(actions[0].identifier).toBe('quarantine');
      expect(actions[0].description).toContain('1 critical flaky test');
    });

    it('should include rerun action for recent failures', () => {
      const recentFailureTests: TestWithLocation[] = [
        {
          testName: 'test.RecentFailure',
          failCount: 2,
          rerunPassRate: 0.8,
          lastFailedRun: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
          confidence: 0.6,
          totalRuns: 10,
          flakeScore: 0.6,
        },
      ];

      const actions = selectTopActions(recentFailureTests);
      
      expect(actions.some(a => a.identifier === 'rerun_failed')).toBe(true);
    });

    it('should create issue action for persistent problems', () => {
      const persistentTests: TestWithLocation[] = [
        {
          testName: 'test.Persistent',
          failCount: 5, // >= 3 failures
          rerunPassRate: 0.7,
          lastFailedRun: null,
          confidence: 0.5,
          totalRuns: 15,
          flakeScore: 0.5,
        },
      ];

      const actions = selectTopActions(persistentTests);
      
      expect(actions.some(a => a.identifier === 'open_issue')).toBe(true);
      const issueAction = actions.find(a => a.identifier === 'open_issue');
      expect(issueAction?.description).toContain('persistent flaky test');
    });

    it('should handle empty test array', () => {
      const actions = selectTopActions([]);
      
      expect(actions).toHaveLength(0);
    });

    it('should customize descriptions based on test counts', () => {
      const multipleTests: TestWithLocation[] = [
        {
          testName: 'test1',
          failCount: 5,
          rerunPassRate: 0.6,
          lastFailedRun: new Date().toISOString(),
          confidence: 0.9,
          totalRuns: 20,
          flakeScore: 0.9,
        },
        {
          testName: 'test2',
          failCount: 4,
          rerunPassRate: 0.7,
          lastFailedRun: new Date().toISOString(),
          confidence: 0.85,
          totalRuns: 18,
          flakeScore: 0.85,
        },
      ];

      const actions = selectTopActions(multipleTests);
      
      const quarantineAction = actions.find(a => a.identifier === 'quarantine');
      expect(quarantineAction?.description).toContain('2 critical flaky tests'); // Plural
      
      const rerunAction = actions.find(a => a.identifier === 'rerun_failed');
      expect(rerunAction?.description).toContain('2 recently failed tests'); // Plural
    });
  });

  describe('calculateSeverity', () => {
    it('should classify scores correctly', () => {
      expect(calculateSeverity(0.9)).toBe('critical');
      expect(calculateSeverity(0.8)).toBe('critical');
      expect(calculateSeverity(0.79)).toBe('warning');
      expect(calculateSeverity(0.5)).toBe('warning');
      expect(calculateSeverity(0.49)).toBe('stable');
      expect(calculateSeverity(0.1)).toBe('stable');
      expect(calculateSeverity(0.0)).toBe('stable');
    });

    it('should handle edge cases', () => {
      expect(calculateSeverity(1.0)).toBe('critical');
      expect(calculateSeverity(-0.1)).toBe('stable');
      expect(calculateSeverity(1.5)).toBe('critical');
    });
  });

  describe('convertFlakeScoresToTests', () => {
    it('should convert FlakeScore objects correctly', () => {
      const mockFlakeScore: FlakeScore = {
        testName: 'example.test.Database',
        testFullName: 'src/tests/database.test.ts:45 Database Connection Test',
        score: 0.85,
        confidence: 0.9,
        features: {
          failSuccessRatio: 0.3,
          rerunPassRate: 0.75,
          failureClustering: 0.6,
          intermittencyScore: 0.8,
          messageSignatureVariance: 0.4,
          totalRuns: 25,
          recentFailures: 8,
          consecutiveFailures: 2,
          maxConsecutiveFailures: 4,
          daysSinceFirstSeen: 30,
          avgTimeBetweenFailures: 2.5,
        } as FlakeFeatures,
        recommendation: {
          action: 'quarantine',
          reason: 'High failure rate with intermittent behavior',
          confidence: 0.9,
          priority: 'high',
        } as QuarantineRecommendation,
        lastUpdated: new Date('2024-01-15T10:30:00Z'),
      };

      const converted = convertFlakeScoresToTests([mockFlakeScore], mockRepository);
      
      expect(converted).toHaveLength(1);
      expect(converted[0].testName).toBe('example.test.Database');
      expect(converted[0].failCount).toBe(8);
      expect(converted[0].rerunPassRate).toBe(0.75);
      expect(converted[0].confidence).toBe(0.9);
      expect(converted[0].totalRuns).toBe(25);
      expect(converted[0].flakeScore).toBe(0.85);
      expect(converted[0].file).toBe('src/tests/database.test.ts');
      expect(converted[0].line).toBe(45);
    });
  });

  describe('convertStabilityMetricsToTests', () => {
    it('should convert TestStabilityMetrics correctly', () => {
      const mockMetrics: TestStabilityMetrics = {
        testName: 'integration.Database',
        testFullName: 'tests/integration/database.spec.js:120 Database Integration Suite',
        repositoryId: 'test-repo-id',
        totalRuns: 50,
        successfulRuns: 40,
        failedRuns: 10,
        skippedRuns: 0,
        errorRuns: 0,
        rerunAttempts: 6,
        rerunSuccesses: 4,
        firstSeen: new Date('2024-01-01T00:00:00Z'),
        lastSeen: new Date('2024-01-15T10:30:00Z'),
        lastFailure: new Date('2024-01-14T15:45:00Z'),
        avgDuration: 2500,
        failureMessages: [] as MessageSignature[],
        failureClusters: [{ 
          timeWindow: { 
            start: new Date('2024-01-14T14:00:00Z'), 
            end: new Date('2024-01-14T16:00:00Z') 
          },
          runs: [],
          density: 0.8,
          avgGap: 300,
        }] as FailureCluster[],
      };

      const converted = convertStabilityMetricsToTests([mockMetrics], mockRepository);
      
      expect(converted).toHaveLength(1);
      expect(converted[0].testName).toBe('integration.Database');
      expect(converted[0].failCount).toBe(10);
      expect(converted[0].totalRuns).toBe(50);
      expect(converted[0].lastFailedRun).toBe('2024-01-14T15:45:00.000Z');
      expect(converted[0].file).toBe('tests/integration/database.spec.js');
      expect(converted[0].line).toBe(120);
      
      // Should calculate confidence based on metrics
      expect(converted[0].confidence).toBeGreaterThan(0);
      expect(converted[0].confidence).toBeLessThanOrEqual(1);
      
      // Should calculate rerun pass rate
      expect(converted[0].rerunPassRate).toBe(4/6); // 4 successes out of 6 attempts
    });

    it('should handle metrics with no reruns', () => {
      const metricsNoReruns: TestStabilityMetrics = {
        testName: 'simple.test',
        testFullName: 'simple.test.js Simple Test',
        repositoryId: 'test-repo',
        totalRuns: 10,
        successfulRuns: 8,
        failedRuns: 2,
        skippedRuns: 0,
        errorRuns: 0,
        rerunAttempts: 0,
        rerunSuccesses: 0,
        firstSeen: new Date(),
        lastSeen: new Date(),
        lastFailure: null,
        avgDuration: 1000,
        failureMessages: [],
        failureClusters: [],
      };

      const converted = convertStabilityMetricsToTests([metricsNoReruns], mockRepository);
      
      expect(converted[0].rerunPassRate).toBeGreaterThanOrEqual(0);
      expect(converted[0].lastFailedRun).toBe(null);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed test data gracefully', () => {
      const malformedTests: TestWithLocation[] = [
        {
          testName: '',
          failCount: -1,
          rerunPassRate: 1.5, // Invalid rate > 1
          lastFailedRun: 'invalid-date',
          confidence: 2.0, // Invalid confidence > 1
          totalRuns: 0,
          flakeScore: -0.5, // Invalid negative score
        },
      ];

      // Should not throw
      expect(() => renderCheckRunOutput(malformedTests, mockRepository)).not.toThrow();
      expect(() => selectTopActions(malformedTests)).not.toThrow();
      
      const output = renderCheckRunOutput(malformedTests, mockRepository);
      expect(output.title).toBeDefined();
      expect(output.summary).toBeDefined();
      expect(output.actions.length).toBeLessThanOrEqual(3);
    });

    it('should handle repository with missing information', () => {
      const incompleteRepo: Repository = {
        owner: 'test-org',
        repo: 'test-repo',
        // Missing defaultBranch
      };

      const link = generateFileLink('test.ts', 1, incompleteRepo);
      expect(link).toContain('/blob/main/'); // Should default to main
      
      const output = renderCheckRunOutput(sampleTests, incompleteRepo);
      expect(output.title).toBeDefined();
    });

    it('should handle very large number of tests', () => {
      const hugeBatch: TestWithLocation[] = Array.from({ length: 1000 }, (_, i) => ({
        testName: `test.Large${i}`,
        failCount: i % 10,
        rerunPassRate: 0.5 + (i % 50) / 100,
        lastFailedRun: null,
        confidence: (i % 100) / 100,
        totalRuns: 100,
        flakeScore: (i % 100) / 100,
      }));

      const output = renderCheckRunOutput(hugeBatch, mockRepository);
      
      // Should limit to reasonable size
      expect(output.summary.length).toBeLessThan(50000); // Reasonable size limit
      expect(output.actions.length).toBeLessThanOrEqual(3);
      
      // Should show overflow message
      expect(output.summary).toContain('*Showing top 20 of 1000 total candidates.*');
    });

    it('should validate action count constraint in all scenarios', () => {
      const testScenarios = [
        [], // Empty
        [sampleTests[0]], // Single test
        sampleTests, // Normal case
        Array.from({ length: 100 }, () => sampleTests[0]), // Many identical tests
      ];

      testScenarios.forEach((tests, index) => {
        const actions = selectTopActions(tests);
        expect(actions.length).toBeLessThanOrEqual(3);
        expect(actions.length).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle tests with extreme values', () => {
      const extremeTests: TestWithLocation[] = [
        {
          testName: 'a'.repeat(1000), // Very long name
          failCount: 999999,
          rerunPassRate: 0.001,
          lastFailedRun: '1970-01-01T00:00:00Z', // Very old
          confidence: 0.999999,
          totalRuns: 999999,
          flakeScore: 0.999999,
          file: 'very/deeply/nested/path/that/goes/on/forever/test.spec.ts',
          line: 99999,
        },
      ];

      expect(() => renderCheckRunOutput(extremeTests, mockRepository)).not.toThrow();
      
      const output = renderCheckRunOutput(extremeTests, mockRepository);
      expect(output.title).toBeDefined();
      expect(output.summary).toBeDefined();
      expect(output.actions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Snapshot Testing Compatibility', () => {
    it('should produce consistent output for snapshot testing', () => {
      const consistentTests: TestWithLocation[] = [
        {
          testName: 'com.example.integration.DatabaseConnectionTest',
          failCount: 7,
          rerunPassRate: 0.65,
          lastFailedRun: '2024-01-15T10:30:00.000Z',
          confidence: 0.82,
          totalRuns: 25,
          file: 'src/test/java/com/example/integration/DatabaseConnectionTest.java',
          line: 158,
          flakeScore: 0.82,
        },
        {
          testName: 'com.example.unit.AsyncOperationTest',
          failCount: 3,
          rerunPassRate: 0.88,
          lastFailedRun: '2024-01-14T15:45:30.000Z',
          confidence: 0.58,
          totalRuns: 18,
          file: 'src/test/java/com/example/unit/AsyncOperationTest.java',
          line: 92,
          flakeScore: 0.58,
        },
      ];

      const output = renderCheckRunOutput(consistentTests, mockRepository);
      
      // This should be consistent for snapshot testing
      expect(output).toMatchSnapshot('check-run-renderer-output');
    });
  });
});