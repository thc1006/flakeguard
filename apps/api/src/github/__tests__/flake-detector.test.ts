/**
 * Flake Detection Engine Tests
 * 
 * Comprehensive tests for flake detection algorithms including:
 * - Statistical analysis validation
 * - Pattern matching tests
 * - Confidence scoring algorithms
 * - Database interaction tests
 * - Batch processing tests
 * - Edge case handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  FlakeDetector,
  createFlakeDetector,
  type FlakeDetectionConfig,
  type TestExecutionContext,
} from '../flake-detector.js';
import { createMockPrismaClient } from './mocks.js';
import type { CheckRunAction, FlakeAnalysis, TestResult } from '../types.js';
import { FLAKE_DETECTION } from '../constants.js';

describe('FlakeDetector', () => {
  let flakeDetector: FlakeDetector;
  let mockPrisma: PrismaClient;
  let mockConfig: Partial<FlakeDetectionConfig>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockConfig = {
      minRunsForAnalysis: 5,
      flakeThreshold: 0.15,
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.5,
      analysisWindowDays: 30,
      recentFailuresWindowDays: 7,
      commonFlakePatterns: [
        'timeout',
        'connection refused',
        'network error',
        'race condition',
        'timing',
        'intermittent',
      ],
    };
    
    flakeDetector = new FlakeDetector({
      prisma: mockPrisma,
      config: mockConfig,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Test Execution Analysis', () => {
    it('should analyze single test execution with sufficient data', async () => {
      const context: TestExecutionContext = {
        testName: 'integration-test',
        repositoryId: 'repo-1',
        installationId: '12345',
        checkRunId: '123',
        status: 'failed',
        errorMessage: 'Connection timeout',
        timestamp: new Date(),
      };

      const historicalData: TestResult[] = [
        { name: 'integration-test', status: 'passed', createdAt: new Date(Date.now() - 86400000) },
        { name: 'integration-test', status: 'failed', errorMessage: 'timeout', createdAt: new Date(Date.now() - 172800000) },
        { name: 'integration-test', status: 'passed', createdAt: new Date(Date.now() - 259200000) },
        { name: 'integration-test', status: 'failed', errorMessage: 'timeout', createdAt: new Date(Date.now() - 345600000) },
        { name: 'integration-test', status: 'passed', createdAt: new Date(Date.now() - 432000000) },
        { name: 'integration-test', status: 'failed', errorMessage: 'timeout', createdAt: new Date(Date.now() - 518400000) },
      ];

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany.mockResolvedValue(
        historicalData.map(item => ({
          ...item,
          id: Math.random().toString(),
          repositoryId: 'repo-1',
          duration: null,
          stackTrace: null,
          checkRunId: null,
          workflowJobId: null,
          createdAt: item.createdAt,
          updatedAt: new Date(),
        }))
      );
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      const result = await flakeDetector.analyzeTestExecution(context);

      expect(result.analysis.isFlaky).toBe(true);
      expect(result.analysis.confidence).toBeGreaterThan(0.5);
      expect(result.analysis.failurePattern).toBe('timeout');
      expect(result.analysis.historicalFailures).toBe(4); // 3 from history + 1 current
      expect(result.analysis.totalRuns).toBe(7); // 6 from history + 1 current
      expect(result.analysis.failureRate).toBeCloseTo(4/7, 2);
      expect(result.shouldUpdateCheckRun).toBe(true);
      expect(result.suggestedActions).toContain('quarantine');
      expect(result.confidenceLevel).toBe('medium');

      expect(mockPrisma.testResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'integration-test',
          status: 'failed',
          errorMessage: 'Connection timeout',
          repositoryId: 'repo-1',
          checkRunId: '123',
        }),
      });

      expect(mockPrisma.flakeDetection.upsert).toHaveBeenCalledWith({
        where: {
          testName_repositoryId: {
            testName: 'integration-test',
            repositoryId: 'repo-1',
          },
        },
        update: expect.objectContaining({
          isFlaky: true,
          confidence: expect.any(Number),
          failurePattern: 'timeout',
        }),
        create: expect.objectContaining({
          testName: 'integration-test',
          repositoryId: 'repo-1',
          installationId: '12345',
          isFlaky: true,
        }),
      });
    });

    it('should not flag stable test as flaky', async () => {
      const context: TestExecutionContext = {
        testName: 'unit-test',
        repositoryId: 'repo-1',
        installationId: '12345',
        status: 'passed',
        timestamp: new Date(),
      };

      const historicalData: TestResult[] = [
        { name: 'unit-test', status: 'passed', createdAt: new Date(Date.now() - 86400000) },
        { name: 'unit-test', status: 'passed', createdAt: new Date(Date.now() - 172800000) },
        { name: 'unit-test', status: 'passed', createdAt: new Date(Date.now() - 259200000) },
        { name: 'unit-test', status: 'passed', createdAt: new Date(Date.now() - 345600000) },
        { name: 'unit-test', status: 'passed', createdAt: new Date(Date.now() - 432000000) },
      ];

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany.mockResolvedValue(
        historicalData.map(item => ({
          ...item,
          id: Math.random().toString(),
          repositoryId: 'repo-1',
          duration: null,
          stackTrace: null,
          errorMessage: null,
          checkRunId: null,
          workflowJobId: null,
          createdAt: item.createdAt,
          updatedAt: new Date(),
        }))
      );
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      const result = await flakeDetector.analyzeTestExecution(context);

      expect(result.analysis.isFlaky).toBe(false);
      expect(result.analysis.confidence).toBeLessThan(0.5);
      expect(result.analysis.failureRate).toBe(0);
      expect(result.shouldUpdateCheckRun).toBe(false);
      expect(result.confidenceLevel).toBe('low');
    });

    it('should not flag test with insufficient data', async () => {
      const context: TestExecutionContext = {
        testName: 'new-test',
        repositoryId: 'repo-1',
        installationId: '12345',
        status: 'failed',
        timestamp: new Date(),
      };

      const historicalData: TestResult[] = [
        { name: 'new-test', status: 'failed', createdAt: new Date(Date.now() - 86400000) },
        { name: 'new-test', status: 'passed', createdAt: new Date(Date.now() - 172800000) },
      ];

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany.mockResolvedValue(
        historicalData.map(item => ({
          ...item,
          id: Math.random().toString(),
          repositoryId: 'repo-1',
          duration: null,
          stackTrace: null,
          errorMessage: null,
          checkRunId: null,
          workflowJobId: null,
          createdAt: item.createdAt,
          updatedAt: new Date(),
        }))
      );

      const result = await flakeDetector.analyzeTestExecution(context);

      expect(result.analysis.isFlaky).toBe(false);
      expect(result.analysis.totalRuns).toBe(3); // 2 from history + 1 current
      expect(result.shouldUpdateCheckRun).toBe(false);
    });

    it('should handle high confidence flaky test', async () => {
      const context: TestExecutionContext = {
        testName: 'flaky-test',
        repositoryId: 'repo-1',
        installationId: '12345',
        status: 'failed',
        errorMessage: 'Connection refused',
        timestamp: new Date(),
      };

      // Create a pattern with high failure rate and known flaky patterns
      const historicalData: TestResult[] = Array.from({ length: 19 }, (_, i) => ({
        name: 'flaky-test',
        status: i % 2 === 0 ? 'failed' : 'passed', // 50% failure rate
        errorMessage: i % 2 === 0 ? 'connection refused' : undefined,
        createdAt: new Date(Date.now() - (i + 1) * 86400000),
      }));

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany.mockResolvedValue(
        historicalData.map(item => ({
          ...item,
          id: Math.random().toString(),
          repositoryId: 'repo-1',
          duration: null,
          stackTrace: null,
          checkRunId: null,
          workflowJobId: null,
          createdAt: item.createdAt,
          updatedAt: new Date(),
        }))
      );
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      const result = await flakeDetector.analyzeTestExecution(context);

      expect(result.analysis.isFlaky).toBe(true);
      expect(result.analysis.confidence).toBeGreaterThan(0.8);
      expect(result.analysis.failurePattern).toBe('connection refused');
      expect(result.confidenceLevel).toBe('high');
      expect(result.suggestedActions).toContain('quarantine');
    });
  });

  describe('Batch Test Analysis', () => {
    it('should analyze multiple tests efficiently', async () => {
      const contexts: TestExecutionContext[] = [
        {
          testName: 'test-1',
          repositoryId: 'repo-1',
          installationId: '12345',
          status: 'failed',
          timestamp: new Date(),
        },
        {
          testName: 'test-2',
          repositoryId: 'repo-1',
          installationId: '12345',
          status: 'passed',
          timestamp: new Date(),
        },
        {
          testName: 'test-3',
          repositoryId: 'repo-2',
          installationId: '12345',
          status: 'failed',
          timestamp: new Date(),
        },
      ];

      // Mock historical data for each test
      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany
        .mockResolvedValueOnce([]) // test-1 - no history
        .mockResolvedValueOnce([]) // test-2 - no history
        .mockResolvedValueOnce([]); // test-3 - no history
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      const results = await flakeDetector.batchAnalyzeTests(contexts);

      expect(results).toHaveLength(3);
      expect(mockPrisma.testResult.create).toHaveBeenCalledTimes(3);
      expect(mockPrisma.flakeDetection.upsert).toHaveBeenCalledTimes(3);

      // Should group by repository for efficiency
      expect(mockPrisma.testResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: 'test-1',
            repositoryId: 'repo-1',
          }),
        })
      );
    });

    it('should handle errors in individual test analysis', async () => {
      const contexts: TestExecutionContext[] = [
        {
          testName: 'test-1',
          repositoryId: 'repo-1',
          installationId: '12345',
          status: 'failed',
          timestamp: new Date(),
        },
        {
          testName: 'test-2',
          repositoryId: 'repo-1',
          installationId: '12345',
          status: 'passed',
          timestamp: new Date(),
        },
      ];

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce([]);
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      // Should handle partial failures
      await expect(flakeDetector.batchAnalyzeTests(contexts)).rejects.toThrow('Database error');
    });
  });

  describe('Flake Status Management', () => {
    it('should get flake status for existing test', async () => {
      const mockFlakeDetection = {
        testName: 'flaky-test',
        repositoryId: 'repo-1',
        isFlaky: true,
        confidence: 0.85,
        failurePattern: 'timeout',
        historicalFailures: 8,
        totalRuns: 15,
        failureRate: 8/15,
        lastFailureAt: new Date('2024-01-01T10:00:00Z'),
        suggestedAction: 'quarantine',
      };

      mockPrisma.flakeDetection.findUnique.mockResolvedValue(mockFlakeDetection as any);

      const status = await flakeDetector.getFlakeStatus('flaky-test', 'repo-1');

      expect(status).toBeDefined();
      expect(status?.isFlaky).toBe(true);
      expect(status?.confidence).toBe(0.85);
      expect(status?.failurePattern).toBe('timeout');
      expect(status?.lastFailureAt).toBe('2024-01-01T10:00:00.000Z');
      expect(status?.suggestedAction).toBe('quarantine');

      expect(mockPrisma.flakeDetection.findUnique).toHaveBeenCalledWith({
        where: {
          testName_repositoryId: {
            testName: 'flaky-test',
            repositoryId: 'repo-1',
          },
        },
      });
    });

    it('should return null for non-existent test', async () => {
      mockPrisma.flakeDetection.findUnique.mockResolvedValue(null);

      const status = await flakeDetector.getFlakeStatus('unknown-test', 'repo-1');

      expect(status).toBeNull();
    });

    it('should update flake status', async () => {
      mockPrisma.flakeDetection.update.mockResolvedValue({} as any);

      await flakeDetector.updateFlakeStatus(
        'flaky-test',
        'repo-1',
        'quarantine',
        { userId: 'user-1', reason: 'Too unstable' }
      );

      expect(mockPrisma.flakeDetection.update).toHaveBeenCalledWith({
        where: {
          testName_repositoryId: {
            testName: 'flaky-test',
            repositoryId: 'repo-1',
          },
        },
        data: {
          status: 'quarantined',
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should handle different status update actions', async () => {
      mockPrisma.flakeDetection.update.mockResolvedValue({} as any);

      const testCases: Array<{ action: CheckRunAction; expectedStatus: string | undefined }> = [
        { action: 'quarantine', expectedStatus: 'quarantined' },
        { action: 'dismiss_flake', expectedStatus: 'dismissed' },
        { action: 'mark_stable', expectedStatus: 'stable' },
        { action: 'rerun_failed', expectedStatus: undefined }, // No status change
        { action: 'open_issue', expectedStatus: undefined }, // No status change
      ];

      for (const { action, expectedStatus } of testCases) {
        vi.clearAllMocks();
        
        await flakeDetector.updateFlakeStatus('test', 'repo-1', action, {});

        if (expectedStatus) {
          expect(mockPrisma.flakeDetection.update).toHaveBeenCalledWith({
            where: {
              testName_repositoryId: {
                testName: 'test',
                repositoryId: 'repo-1',
              },
            },
            data: {
              status: expectedStatus,
              updatedAt: expect.any(Date),
            },
          });
        } else {
          expect(mockPrisma.flakeDetection.update).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe('Repository Flake Summary', () => {
    it('should generate comprehensive repository summary', async () => {
      const mockCounts = [5, 2, 1]; // totalFlaky, totalQuarantined, recentlyDetected
      const mockTopFlaky = [
        {
          testName: 'integration-test-1',
          confidence: 0.9,
          failureRate: 0.6,
          lastFailureAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          testName: 'integration-test-2',
          confidence: 0.8,
          failureRate: 0.4,
          lastFailureAt: new Date('2024-01-01T09:00:00Z'),
        },
      ];

      mockPrisma.flakeDetection.count
        .mockResolvedValueOnce(mockCounts[0])
        .mockResolvedValueOnce(mockCounts[1])
        .mockResolvedValueOnce(mockCounts[2]);
      mockPrisma.flakeDetection.findMany.mockResolvedValue(mockTopFlaky as any);

      const summary = await flakeDetector.getRepositoryFlakeSummary('repo-1');

      expect(summary.totalFlaky).toBe(5);
      expect(summary.totalQuarantined).toBe(2);
      expect(summary.recentlyDetected).toBe(1);
      expect(summary.topFlaky).toHaveLength(2);
      expect(summary.topFlaky[0].testName).toBe('integration-test-1');
      expect(summary.topFlaky[0].lastFailureAt).toBe('2024-01-01T10:00:00.000Z');

      // Verify queries were made with correct filters
      expect(mockPrisma.flakeDetection.count).toHaveBeenCalledWith({
        where: {
          repositoryId: 'repo-1',
          isFlaky: true,
        },
      });

      expect(mockPrisma.flakeDetection.count).toHaveBeenCalledWith({
        where: {
          repositoryId: 'repo-1',
          status: 'quarantined',
        },
      });

      expect(mockPrisma.flakeDetection.findMany).toHaveBeenCalledWith({
        where: {
          repositoryId: 'repo-1',
          isFlaky: true,
        },
        select: {
          testName: true,
          confidence: true,
          failureRate: true,
          lastFailureAt: true,
        },
        orderBy: [
          { confidence: 'desc' },
          { failureRate: 'desc' },
        ],
        take: 10,
      });
    });

    it('should handle empty repository', async () => {
      mockPrisma.flakeDetection.count.mockResolvedValue(0);
      mockPrisma.flakeDetection.findMany.mockResolvedValue([]);

      const summary = await flakeDetector.getRepositoryFlakeSummary('empty-repo');

      expect(summary.totalFlaky).toBe(0);
      expect(summary.totalQuarantined).toBe(0);
      expect(summary.recentlyDetected).toBe(0);
      expect(summary.topFlaky).toHaveLength(0);
    });
  });

  describe('Pattern Analysis', () => {
    it('should detect common flake patterns', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      const timeoutFailures: TestResult[] = [
        { name: 'test', status: 'failed', errorMessage: 'Connection timeout after 30s' },
        { name: 'test', status: 'failed', errorMessage: 'Request timeout' },
        { name: 'test', status: 'failed', errorMessage: 'Operation timed out' },
      ];

      const pattern = flakeDetectorInstance.analyzeFailurePattern(timeoutFailures);
      expect(pattern).toBe('timeout');
    });

    it('should detect repeated error patterns', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      const repeatFailures: TestResult[] = [
        { name: 'test', status: 'failed', errorMessage: 'Database connection failed: Connection refused' },
        { name: 'test', status: 'failed', errorMessage: 'Database connection failed: Connection refused' },
        { name: 'test', status: 'failed', errorMessage: 'Database connection failed: Connection refused' },
      ];

      const pattern = flakeDetectorInstance.analyzeFailurePattern(repeatFailures);
      expect(pattern).toBe('Database connection failed: Connection refused');
    });

    it('should return null for inconsistent patterns', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      const randomFailures: TestResult[] = [
        { name: 'test', status: 'failed', errorMessage: 'Error A' },
        { name: 'test', status: 'failed', errorMessage: 'Error B' },
        { name: 'test', status: 'failed', errorMessage: 'Error C' },
      ];

      const pattern = flakeDetectorInstance.analyzeFailurePattern(randomFailures);
      expect(pattern).toBeNull();
    });

    it('should handle empty failure list', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      const pattern = flakeDetectorInstance.analyzeFailurePattern([]);
      expect(pattern).toBeNull();
    });
  });

  describe('Confidence Scoring', () => {
    it('should calculate confidence based on multiple factors', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      // High confidence scenario
      const highConfidenceParams = {
        totalRuns: 20,
        historicalFailures: 8,
        failureRate: 0.4,
        failurePattern: 'timeout', // Known flaky pattern
        currentStatus: 'failed',
        hasRecentFailure: true,
      };

      const highConfidence = flakeDetectorInstance.calculateConfidenceScore(highConfidenceParams);
      expect(highConfidence).toBeGreaterThan(0.8);

      // Low confidence scenario
      const lowConfidenceParams = {
        totalRuns: 5,
        historicalFailures: 1,
        failureRate: 0.2,
        failurePattern: null,
        currentStatus: 'passed',
        hasRecentFailure: false,
      };

      const lowConfidence = flakeDetectorInstance.calculateConfidenceScore(lowConfidenceParams);
      expect(lowConfidence).toBeLessThan(0.5);
    });

    it('should give bonus for known flaky patterns', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      const baseParams = {
        totalRuns: 10,
        historicalFailures: 3,
        failureRate: 0.3,
        currentStatus: 'failed',
        hasRecentFailure: true,
      };

      const withPattern = flakeDetectorInstance.calculateConfidenceScore({
        ...baseParams,
        failurePattern: 'race condition', // Known flaky pattern
      });

      const withoutPattern = flakeDetectorInstance.calculateConfidenceScore({
        ...baseParams,
        failurePattern: null,
      });

      expect(withPattern).toBeGreaterThan(withoutPattern);
    });

    it('should handle edge cases', () => {
      const flakeDetectorInstance = flakeDetector as any;
      
      // Ensure confidence is bounded between 0 and 1
      const extremeParams = {
        totalRuns: 100,
        historicalFailures: 50,
        failureRate: 1.0, // 100% failure rate
        failurePattern: 'timeout',
        currentStatus: 'failed',
        hasRecentFailure: true,
      };

      const confidence = flakeDetectorInstance.calculateConfidenceScore(extremeParams);
      expect(confidence).toBeLessThanOrEqual(1.0);
      expect(confidence).toBeGreaterThanOrEqual(0.0);
    });
  });

  describe('Flakiness Determination', () => {
    it('should determine flakiness correctly', () => {
      const flakeDetectorInstance = flakeDetector as any;

      // Flaky test case
      const flakyParams = {
        totalRuns: 10,
        failureRate: 0.3, // Above threshold
        confidence: 0.7, // Above medium threshold
        failurePattern: 'timeout',
      };

      expect(flakeDetectorInstance.determineFlakiness(flakyParams)).toBe(true);

      // Stable test case
      const stableParams = {
        totalRuns: 10,
        failureRate: 0.05, // Below threshold
        confidence: 0.3,
        failurePattern: null,
      };

      expect(flakeDetectorInstance.determineFlakiness(stableParams)).toBe(false);

      // Always failing test
      const alwaysFailingParams = {
        totalRuns: 10,
        failureRate: 1.0, // Always fails
        confidence: 0.8,
        failurePattern: 'error',
      };

      expect(flakeDetectorInstance.determineFlakiness(alwaysFailingParams)).toBe(false);

      // Never failing test
      const neverFailingParams = {
        totalRuns: 10,
        failureRate: 0.0, // Never fails
        confidence: 0.8,
        failurePattern: null,
      };

      expect(flakeDetectorInstance.determineFlakiness(neverFailingParams)).toBe(false);

      // Insufficient data
      const insufficientDataParams = {
        totalRuns: 2, // Below minimum
        failureRate: 0.5,
        confidence: 0.8,
        failurePattern: 'error',
      };

      expect(flakeDetectorInstance.determineFlakiness(insufficientDataParams)).toBe(false);
    });
  });

  describe('Action Suggestion', () => {
    it('should suggest quarantine for high confidence flaky tests', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const highConfidenceParams = {
        isFlaky: true,
        confidence: 0.9,
        failureRate: 0.5,
        totalRuns: 20,
      };

      const action = flakeDetectorInstance.suggestAction(highConfidenceParams);
      expect(action).toBe('quarantine');
    });

    it('should suggest issue creation for medium confidence', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const mediumConfidenceParams = {
        isFlaky: true,
        confidence: 0.6,
        failureRate: 0.2,
        totalRuns: 15,
      };

      const action = flakeDetectorInstance.suggestAction(mediumConfidenceParams);
      expect(action).toBe('open_issue');
    });

    it('should suggest rerun for low confidence', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const lowConfidenceParams = {
        isFlaky: true,
        confidence: 0.4,
        failureRate: 0.2,
        totalRuns: 8,
      };

      const action = flakeDetectorInstance.suggestAction(lowConfidenceParams);
      expect(action).toBe('rerun_failed');
    });

    it('should return null for non-flaky tests', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const nonFlakyParams = {
        isFlaky: false,
        confidence: 0.8,
        failureRate: 0.0,
        totalRuns: 10,
      };

      const action = flakeDetectorInstance.suggestAction(nonFlakyParams);
      expect(action).toBeNull();
    });
  });

  describe('Suggested Actions Generation', () => {
    it('should generate appropriate actions for high confidence flaky tests', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const analysis: FlakeAnalysis = {
        isFlaky: true,
        confidence: 0.9,
        failurePattern: 'timeout',
        historicalFailures: 8,
        totalRuns: 15,
        failureRate: 0.533,
        lastFailureAt: new Date().toISOString(),
        suggestedAction: 'quarantine',
      };

      const actions = flakeDetectorInstance.generateSuggestedActions(analysis, 'high');

      expect(actions).toContain('rerun_failed');
      expect(actions).toContain('quarantine');
      expect(actions).toContain('open_issue');
      expect(actions).toContain('dismiss_flake');
    });

    it('should generate appropriate actions for medium confidence', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const analysis: FlakeAnalysis = {
        isFlaky: true,
        confidence: 0.6,
        failurePattern: null,
        historicalFailures: 3,
        totalRuns: 10,
        failureRate: 0.3,
        lastFailureAt: new Date().toISOString(),
        suggestedAction: 'open_issue',
      };

      const actions = flakeDetectorInstance.generateSuggestedActions(analysis, 'medium');

      expect(actions).toContain('rerun_failed');
      expect(actions).toContain('open_issue');
      expect(actions).toContain('quarantine');
      expect(actions).toContain('dismiss_flake');
    });

    it('should generate basic actions for non-flaky tests', () => {
      const flakeDetectorInstance = flakeDetector as any;

      const analysis: FlakeAnalysis = {
        isFlaky: false,
        confidence: 0.2,
        failurePattern: null,
        historicalFailures: 1,
        totalRuns: 10,
        failureRate: 0.1,
        lastFailureAt: null,
        suggestedAction: null,
      };

      const actions = flakeDetectorInstance.generateSuggestedActions(analysis, 'low');

      expect(actions).toContain('rerun_failed');
      expect(actions).not.toContain('quarantine');
      expect(actions).not.toContain('open_issue');
    });
  });

  describe('Database Error Handling', () => {
    it('should handle database errors gracefully during test storage', async () => {
      const context: TestExecutionContext = {
        testName: 'test',
        repositoryId: 'repo-1',
        installationId: '12345',
        status: 'failed',
        timestamp: new Date(),
      };

      mockPrisma.testResult.create.mockRejectedValue(new Error('Database error'));
      mockPrisma.testResult.findMany.mockResolvedValue([]);
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      // Should not throw even if test result storage fails
      const result = await flakeDetector.analyzeTestExecution(context);
      
      expect(result).toBeDefined();
      expect(result.analysis.isFlaky).toBe(false); // Insufficient data
    });

    it('should handle database errors during historical data retrieval', async () => {
      const context: TestExecutionContext = {
        testName: 'test',
        repositoryId: 'repo-1',
        installationId: '12345',
        status: 'failed',
        timestamp: new Date(),
      };

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany.mockRejectedValue(new Error('Database error'));
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      const result = await flakeDetector.analyzeTestExecution(context);
      
      expect(result).toBeDefined();
      expect(result.analysis.totalRuns).toBe(1); // Only current test
      expect(result.analysis.historicalFailures).toBe(1);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large amounts of historical data', async () => {
      const context: TestExecutionContext = {
        testName: 'performance-test',
        repositoryId: 'repo-1',
        installationId: '12345',
        status: 'failed',
        timestamp: new Date(),
      };

      // Generate 1000 historical results
      const largeHistoricalData: TestResult[] = Array.from({ length: 1000 }, (_, i) => ({
        name: 'performance-test',
        status: i % 3 === 0 ? 'failed' : 'passed', // ~33% failure rate
        errorMessage: i % 3 === 0 ? 'intermittent error' : undefined,
        createdAt: new Date(Date.now() - i * 86400000),
      }));

      mockPrisma.testResult.create.mockResolvedValue({} as any);
      mockPrisma.testResult.findMany.mockResolvedValue(
        largeHistoricalData.map(item => ({
          ...item,
          id: Math.random().toString(),
          repositoryId: 'repo-1',
          duration: null,
          stackTrace: null,
          checkRunId: null,
          workflowJobId: null,
          createdAt: item.createdAt,
          updatedAt: new Date(),
        }))
      );
      mockPrisma.flakeDetection.upsert.mockResolvedValue({} as any);

      const startTime = Date.now();
      const result = await flakeDetector.analyzeTestExecution(context);
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(result.analysis.totalRuns).toBe(1001);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle extreme failure rates', async () => {
      const flakeDetectorInstance = flakeDetector as any;

      // Test 99% failure rate
      const highFailureParams = {
        totalRuns: 100,
        failureRate: 0.99,
        confidence: 0.7,
        failurePattern: 'error',
      };

      expect(flakeDetectorInstance.determineFlakiness(highFailureParams)).toBe(false);

      // Test 1% failure rate
      const lowFailureParams = {
        totalRuns: 100,
        failureRate: 0.01,
        confidence: 0.7,
        failurePattern: 'error',
      };

      expect(flakeDetectorInstance.determineFlakiness(lowFailureParams)).toBe(false);
    });
  });

  describe('Configuration Customization', () => {
    it('should use custom configuration parameters', () => {
      const customConfig: Partial<FlakeDetectionConfig> = {
        minRunsForAnalysis: 3,
        flakeThreshold: 0.1,
        highConfidenceThreshold: 0.9,
        mediumConfidenceThreshold: 0.6,
      };

      const customDetector = new FlakeDetector({
        prisma: mockPrisma,
        config: customConfig,
      });

      const detectorInstance = customDetector as any;
      expect(detectorInstance.config.minRunsForAnalysis).toBe(3);
      expect(detectorInstance.config.flakeThreshold).toBe(0.1);
      expect(detectorInstance.config.highConfidenceThreshold).toBe(0.9);
      expect(detectorInstance.config.mediumConfidenceThreshold).toBe(0.6);
    });

    it('should merge custom config with defaults', () => {
      const partialConfig: Partial<FlakeDetectionConfig> = {
        minRunsForAnalysis: 8,
      };

      const detector = new FlakeDetector({
        prisma: mockPrisma,
        config: partialConfig,
      });

      const detectorInstance = detector as any;
      expect(detectorInstance.config.minRunsForAnalysis).toBe(8);
      expect(detectorInstance.config.flakeThreshold).toBe(FLAKE_DETECTION.FLAKY_THRESHOLD);
      expect(detectorInstance.config.analysisWindowDays).toBe(FLAKE_DETECTION.ANALYSIS_WINDOW_DAYS);
    });
  });

  describe('Factory Function', () => {
    it('should create detector instance with factory function', () => {
      const detector = createFlakeDetector({ prisma: mockPrisma });
      expect(detector).toBeInstanceOf(FlakeDetector);
    });

    it('should create detector with custom config using factory', () => {
      const customConfig = { minRunsForAnalysis: 10 };
      const detector = createFlakeDetector({ 
        prisma: mockPrisma,
        config: customConfig,
      });
      
      const detectorInstance = detector as any;
      expect(detectorInstance.config.minRunsForAnalysis).toBe(10);
    });
  });
});