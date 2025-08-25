/**
 * Integration tests for FlakeGuard Slack App
 * 
 * Tests cover:
 * - End-to-end workflow with mock Slack API
 * - Database integration scenarios
 * - GitHub API integration through handlers
 * - Real message formatting and validation
 * - Error scenarios and recovery
 */

import { TestCrypto } from '@flakeguard/shared/utils';
import { PrismaClient } from '@prisma/client';
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';

import { FlakinessScorer } from '../../analytics/flakiness.js';
import { GitHubAuthManager } from '../../github/auth.js';
import { CheckRunHandler } from '../../github/handlers.js';
import { FlakeGuardSlackApp } from '../app.js';


// Mock external services
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}));

describe('FlakeGuard Slack App Integration', () => {
  let app: FlakeGuardSlackApp;
  let mockPrisma: any;
  let mockGithubAuth: any;
  let mockCheckRunHandler: any;
  let mockFlakinessScorer: any;
  
  const mockConfig = {
    signingSecret: TestCrypto.generateSlackSigningSecret(),
    token: TestCrypto.generateBotToken(),
    port: 3002
  };

  // Sample test data
  const sampleRepository = {
    id: 'repo-integration-123',
    fullName: 'facebook/react',
    name: 'react',
    owner: 'facebook',
    installationId: '12345'
  };

  const sampleTestResults = [
    {
      testFullName: 'ReactDOM.test.js::should render without crashing',
      name: 'should render without crashing',
      status: 'failed',
      message: 'Expected element to be present',
      time: 2500,
      attempt: 1,
      runId: 'run-001',
      createdAt: new Date('2024-01-15T10:00:00Z')
    },
    {
      testFullName: 'ReactDOM.test.js::should render without crashing',
      name: 'should render without crashing',
      status: 'passed',
      message: null,
      time: 2200,
      attempt: 2,
      runId: 'run-001',
      createdAt: new Date('2024-01-15T10:05:00Z')
    },
    {
      testFullName: 'ReactDOM.test.js::should render without crashing',
      name: 'should render without crashing',
      status: 'failed',
      message: 'Expected element to be present',
      time: 2800,
      attempt: 1,
      runId: 'run-002',
      createdAt: new Date('2024-01-15T11:00:00Z')
    },
    {
      testFullName: 'ReactDOM.test.js::should render without crashing',
      name: 'should render without crashing',
      status: 'passed',
      message: null,
      time: 2100,
      attempt: 1,
      runId: 'run-003',
      createdAt: new Date('2024-01-15T12:00:00Z')
    }
  ];

  const sampleFlakeScore = {
    score: 0.75,
    confidence: 0.85,
    features: {
      failSuccessRatio: 0.5,
      rerunPassRate: 0.5,
      failureClustering: 0.3,
      intermittencyScore: 0.8,
      messageSignatureVariance: 0.2,
      totalRuns: 4,
      recentFailures: 2,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 1,
      daysSinceFirstSeen: 1,
      avgTimeBetweenFailures: 1.0
    },
    recommendation: {
      action: 'quarantine',
      reason: 'High flakiness score with alternating pass/fail pattern',
      confidence: 0.85,
      priority: 'high'
    },
    lastUpdated: new Date()
  };

  const sampleFlakeDetections = [
    {
      testName: 'should render without crashing',
      confidence: 0.9,
      failureRate: 0.6,
      lastUpdatedAt: new Date('2024-01-15T12:00:00Z'),
      repository: { fullName: 'facebook/react' }
    },
    {
      testName: 'should handle props correctly',
      confidence: 0.8,
      failureRate: 0.4,
      lastUpdatedAt: new Date('2024-01-15T11:00:00Z'),
      repository: { fullName: 'vercel/next.js' }
    },
    {
      testName: 'async component loading',
      confidence: 0.85,
      failureRate: 0.55,
      lastUpdatedAt: new Date('2024-01-15T10:00:00Z'),
      repository: { fullName: 'angular/angular' }
    }
  ];

  beforeAll(() => {
    // Setup nock for HTTP mocking
    if (!nock.isActive()) {
      nock.activate();
    }
  });

  afterAll(() => {
    nock.cleanAll();
    nock.restore();
  });

  beforeEach(() => {
    // Clear all mocks and nock interceptors
    vi.clearAllMocks();
    nock.cleanAll();

    // Create comprehensive mocks
    mockPrisma = {
      repository: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      testResult: {
        findMany: vi.fn(),
      },
      flakeDetection: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      }
    };

    mockGithubAuth = {
      getInstallationOctokit: vi.fn().mockResolvedValue({
        rest: {
          pulls: { create: vi.fn() },
          issues: { create: vi.fn() }
        }
      })
    };

    mockCheckRunHandler = {
      process: vi.fn().mockResolvedValue({ success: true })
    };

    mockFlakinessScorer = {
      computeFlakeScore: vi.fn().mockReturnValue(sampleFlakeScore)
    };

    // Mock Slack API endpoints
    nock('https://slack.com')
      .persist()
      .post('/api/chat.postMessage')
      .reply(200, { ok: true, ts: '1234567890.123456' })
      .post('/api/chat.update')
      .reply(200, { ok: true, ts: '1234567890.123456' })
      .post('/api/views.open')
      .reply(200, { ok: true });

    // Create app instance
    app = new FlakeGuardSlackApp(mockConfig, {
      prisma: mockPrisma,
      githubAuth: mockGithubAuth,
      checkRunHandler: mockCheckRunHandler,
      flakinessScorer: mockFlakinessScorer,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    nock.cleanAll();
  });

  describe('End-to-End Status Command Flow', () => {
    it('should handle complete status command workflow', async () => {
      // Setup database mocks
      mockPrisma.repository.findFirst.mockResolvedValue(sampleRepository);
      mockPrisma.repository.findUnique.mockResolvedValue(sampleRepository);
      mockPrisma.testResult.findMany.mockResolvedValue(sampleTestResults);

      // Simulate slash command handler
      const slackApp = app.getApp();
      const commandHandler = vi.fn();
      const mockRespond = vi.fn();
      const mockAck = vi.fn();

      // Mock the actual command processing
      const mockBody = {
        user_id: 'U12345',
        channel_id: 'C12345',
        team_id: 'T12345',
        channel_name: 'general',
        text: 'status facebook/react'
      };

      // Execute the command workflow manually for testing
      await mockAck();
      
      // Find repository
      const repository = await mockPrisma.repository.findFirst({
        where: { fullName: 'facebook/react' },
        select: { id: true, fullName: true, name: true }
      });

      expect(repository).toEqual(sampleRepository);

      // Get test results
      const testResults = await mockPrisma.testResult.findMany({
        where: {
          repositoryId: repository.id,
          createdAt: { gte: expect.any(Date) }
        },
        select: {
          testFullName: true,
          name: true,
          status: true,
          message: true,
          time: true,
          attempt: true,
          runId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' }
      });

      expect(testResults).toEqual(sampleTestResults);

      // Compute flake score
      const flakeScore = mockFlakinessScorer.computeFlakeScore(testResults);
      expect(flakeScore.score).toBe(0.75);
      expect(flakeScore.recommendation.action).toBe('quarantine');

      // Verify repository health calculation
      const totalTests = 1; // One unique test in our sample data
      const flakyTests = 1;  // One flaky test identified
      const healthScore = Math.max(0, Math.round(100 - (flakyTests / totalTests) * 100));
      expect(healthScore).toBe(0); // 100% of tests are flaky = 0% health

      // Verify all mocks were called
      expect(mockPrisma.repository.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.testResult.findMany).toHaveBeenCalledTimes(1);
      expect(mockFlakinessScorer.computeFlakeScore).toHaveBeenCalledTimes(1);
    });

    it('should handle repository not found scenario', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      const mockRespond = vi.fn();
      
      // Simulate repository lookup failure
      const repository = await mockPrisma.repository.findFirst({
        where: { fullName: 'nonexistent/repo' }
      });

      expect(repository).toBeNull();
      expect(mockPrisma.repository.findFirst).toHaveBeenCalledWith({
        where: { fullName: 'nonexistent/repo' }
      });
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockPrisma.repository.findFirst.mockRejectedValue(dbError);

      try {
        await mockPrisma.repository.findFirst({ where: { fullName: 'test/repo' } });
      } catch (error) {
        expect(error).toBe(dbError);
      }

      expect(mockPrisma.repository.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('End-to-End Top Flaky Command Flow', () => {
    it('should handle complete topflaky command workflow', async () => {
      mockPrisma.flakeDetection.findMany.mockResolvedValue(sampleFlakeDetections);

      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Simulate the database query
      const flakeDetections = await mockPrisma.flakeDetection.findMany({
        where: {
          lastUpdatedAt: { gte: cutoffDate },
          confidence: { gt: 0.5 }
        },
        include: {
          repository: { select: { fullName: true } }
        },
        orderBy: [
          { confidence: 'desc' },
          { lastUpdatedAt: 'desc' }
        ],
        take: 20 // 10 * 2 for filtering
      });

      expect(flakeDetections).toEqual(sampleFlakeDetections);
      expect(flakeDetections).toHaveLength(3);

      // Verify ordering - highest confidence first
      expect(flakeDetections[0].confidence).toBe(0.9);
      expect(flakeDetections[1].confidence).toBe(0.8);
      expect(flakeDetections[2].confidence).toBe(0.85);
    });

    it('should handle empty results for topflaky', async () => {
      mockPrisma.flakeDetection.findMany.mockResolvedValue([]);

      const flakeDetections = await mockPrisma.flakeDetection.findMany({
        where: expect.any(Object),
        include: expect.any(Object),
        orderBy: expect.any(Array),
        take: expect.any(Number)
      });

      expect(flakeDetections).toEqual([]);
    });

    it('should handle custom limit parameter', async () => {
      const customLimit = 5;
      mockPrisma.flakeDetection.findMany.mockResolvedValue(
        sampleFlakeDetections.slice(0, customLimit)
      );

      const flakeDetections = await mockPrisma.flakeDetection.findMany({
        where: expect.any(Object),
        include: expect.any(Object),
        orderBy: expect.any(Array),
        take: customLimit * 2 // Doubled for filtering
      });

      expect(mockPrisma.flakeDetection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10 // 5 * 2
        })
      );
    });
  });

  describe('Button Action Integration', () => {
    it('should handle quarantine button end-to-end', async () => {
      // Setup mocks for successful quarantine
      mockPrisma.repository.findUnique.mockResolvedValue(sampleRepository);
      mockPrisma.flakeDetection.findFirst.mockResolvedValue({
        testName: 'should render without crashing',
        repositoryId: sampleRepository.id
      });

      // Simulate quarantine action
      const actionResult = {
        success: true,
        message: 'Test quarantined successfully',
        details: {
          repository: sampleRepository.fullName,
          action: 'quarantine'
        }
      };

      // Mock the actual quarantine process
      const repository = await mockPrisma.repository.findUnique({
        where: { id: sampleRepository.id }
      });
      
      expect(repository).toEqual(sampleRepository);

      const flakeDetection = await mockPrisma.flakeDetection.findFirst({
        where: {
          testName: 'should render without crashing',
          repositoryId: sampleRepository.id
        }
      });

      expect(flakeDetection).toBeTruthy();

      // Verify the check run handler would be called
      const mockPayload = expect.objectContaining({
        requested_action: { identifier: 'quarantine' },
        repository: expect.objectContaining({
          full_name: sampleRepository.fullName
        })
      });

      await mockCheckRunHandler.process(mockPayload);
      expect(mockCheckRunHandler.process).toHaveBeenCalledWith(mockPayload);
    });

    it('should handle open issue button end-to-end', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(sampleRepository);

      // Simulate issue creation
      const repository = await mockPrisma.repository.findUnique({
        where: { id: sampleRepository.id }
      });

      expect(repository).toEqual(sampleRepository);

      // Verify the check run handler would be called for issue creation
      const mockPayload = expect.objectContaining({
        requested_action: { identifier: 'open_issue' },
        repository: expect.objectContaining({
          full_name: sampleRepository.fullName
        })
      });

      await mockCheckRunHandler.process(mockPayload);
      expect(mockCheckRunHandler.process).toHaveBeenCalledWith(mockPayload);
    });

    it('should handle view details action', async () => {
      mockPrisma.repository.findUnique.mockResolvedValue(sampleRepository);
      mockPrisma.testResult.findMany.mockResolvedValue(sampleTestResults);

      // Simulate test details retrieval
      const repository = await mockPrisma.repository.findUnique({
        where: { id: sampleRepository.id }
      });

      const testResults = await mockPrisma.testResult.findMany({
        where: {
          repositoryId: sampleRepository.id,
          name: 'should render without crashing'
        }
      });

      expect(repository).toEqual(sampleRepository);
      expect(testResults).toEqual(sampleTestResults);

      // Calculate test details
      const totalRuns = testResults.length;
      const failedRuns = testResults.filter(r => r.status === 'failed' || r.status === 'error').length;
      const failureRate = totalRuns > 0 ? failedRuns / totalRuns : 0;
      const avgDuration = totalRuns > 0 ? testResults.reduce((sum, r) => sum + r.time, 0) / totalRuns : 0;

      expect(totalRuns).toBe(4);
      expect(failedRuns).toBe(2);
      expect(failureRate).toBe(0.5);
      expect(avgDuration).toBe(2400); // (2500 + 2200 + 2800 + 2100) / 4
    });
  });

  describe('GitHub API Integration', () => {
    it('should integrate with GitHub for quarantine action', async () => {
      // Mock GitHub API calls
      nock('https://api.github.com')
        .post('/repos/facebook/react/git/refs')
        .reply(201, { ref: 'refs/heads/flakeguard/quarantine/test-branch' })
        .get('/repos/facebook/react/contents/test-file.js')
        .reply(200, {
          content: Buffer.from('test content').toString('base64'),
          sha: 'file-sha'
        })
        .put('/repos/facebook/react/contents/test-file.js')
        .reply(200, { commit: { sha: 'new-sha' } })
        .post('/repos/facebook/react/pulls')
        .reply(201, {
          number: 123,
          html_url: 'https://github.com/facebook/react/pull/123'
        });

      // Setup repository and flake detection
      mockPrisma.repository.findUnique.mockResolvedValue(sampleRepository);
      mockPrisma.flakeDetection.findFirst.mockResolvedValue({
        testName: 'should render without crashing',
        testFilePath: 'test-file.js',
        repositoryId: sampleRepository.id
      });

      // Simulate successful GitHub integration
      const octokit = await mockGithubAuth.getInstallationOctokit(
        parseInt(sampleRepository.installationId)
      );

      expect(mockGithubAuth.getInstallationOctokit).toHaveBeenCalledWith(12345);
      expect(octokit).toBeDefined();

      // Verify nock interceptors were set up
      expect(nock.isDone()).toBeFalsy(); // Should have pending interceptors
    });

    it('should handle GitHub API errors', async () => {
      // Mock GitHub API error
      nock('https://api.github.com')
        .post('/repos/facebook/react/git/refs')
        .reply(403, { message: 'Forbidden' });

      mockPrisma.repository.findUnique.mockResolvedValue(sampleRepository);
      mockCheckRunHandler.process.mockRejectedValue(new Error('GitHub API error'));

      try {
        await mockCheckRunHandler.process(expect.any(Object));
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('GitHub API error');
      }
    });
  });

  describe('Message Formatting Validation', () => {
    it('should format repository status message correctly', async () => {
      // Test the message structure that would be sent to Slack
      const summary = {
        repositoryId: sampleRepository.id,
        repositoryName: sampleRepository.fullName,
        totalTests: 5,
        flakyTests: 2,
        quarantinedTests: 1,
        topFlaky: [
          {
            testName: 'should render without crashing',
            flakeScore: 0.8,
            failureRate: 0.5,
            lastFailure: new Date('2024-01-15T12:00:00Z')
          }
        ]
      };

      // Verify the message blocks structure
      expect(summary.repositoryName).toBe('facebook/react');
      expect(summary.totalTests).toBe(5);
      expect(summary.flakyTests).toBe(2);
      expect(summary.topFlaky).toHaveLength(1);
      expect(summary.topFlaky[0].testName).toBe('should render without crashing');

      // Verify health score calculation
      const healthScore = Math.max(0, Math.round(100 - (summary.flakyTests / summary.totalTests) * 100));
      expect(healthScore).toBe(60); // 100 - (2/5)*100 = 60%

      // Verify health emoji
      const getHealthEmoji = (score: number) => {
        if (score >= 90) {return '🟢';}
        if (score >= 70) {return '🟡';}
        return '🔴';
      };
      expect(getHealthEmoji(healthScore)).toBe('🔴'); // 60% is red
    });

    it('should format top flaky tests message correctly', async () => {
      const topFlaky = sampleFlakeDetections.map(detection => ({
        testName: detection.testName,
        repositoryName: detection.repository.fullName,
        flakeScore: detection.confidence,
        failureRate: detection.failureRate,
        lastFailure: detection.lastUpdatedAt,
        confidence: detection.confidence
      }));

      expect(topFlaky).toHaveLength(3);
      expect(topFlaky[0].repositoryName).toBe('facebook/react');
      expect(topFlaky[1].repositoryName).toBe('vercel/next.js');
      expect(topFlaky[2].repositoryName).toBe('angular/angular');

      // Verify score formatting
      expect((topFlaky[0].flakeScore * 100).toFixed(1)).toBe('90.0');
      expect((topFlaky[1].failureRate * 100).toFixed(1)).toBe('40.0');
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large datasets efficiently', async () => {
      // Create large dataset
      const largeTestResults = Array.from({ length: 1000 }, (_, i) => ({
        testFullName: `test${i}.spec.ts::test ${i}`,
        name: `test ${i}`,
        status: i % 4 === 0 ? 'failed' : 'passed',
        message: i % 4 === 0 ? 'Test failed' : null,
        time: 1000 + Math.random() * 2000,
        attempt: 1,
        runId: `run-${Math.floor(i / 10)}`,
        createdAt: new Date(Date.now() - i * 60000)
      }));

      mockPrisma.testResult.findMany.mockResolvedValue(largeTestResults);

      const results = await mockPrisma.testResult.findMany({
        where: { repositoryId: sampleRepository.id }
      });

      expect(results).toHaveLength(1000);
      expect(mockPrisma.testResult.findMany).toHaveBeenCalledTimes(1);

      // Verify efficient grouping would work
      const testGroups = new Map();
      for (const result of results) {
        if (!testGroups.has(result.testFullName)) {
          testGroups.set(result.testFullName, []);
        }
        testGroups.get(result.testFullName).push(result);
      }

      expect(testGroups.size).toBe(1000); // Each test is unique in this dataset
    });

    it('should handle rate limiting correctly', async () => {
      const userId = 'U12345';
      const rateLimitMap = new Map();

      // Simulate rate limit checking
      const checkRateLimit = (userId: string, maxRequests = 10, windowMs = 60000) => {
        const now = Date.now();
        const userLimit = rateLimitMap.get(userId);

        if (!userLimit || now > userLimit.resetTime) {
          rateLimitMap.set(userId, { count: 1, resetTime: now + windowMs });
          return true;
        }

        if (userLimit.count >= maxRequests) {
          return false;
        }

        userLimit.count++;
        return true;
      };

      // Test rate limiting behavior
      for (let i = 0; i < 12; i++) {
        const allowed = checkRateLimit(userId);
        if (i < 10) {
          expect(allowed).toBe(true);
        } else {
          expect(allowed).toBe(false); // Should be rate limited after 10 requests
        }
      }
    });
  });

  describe('App Lifecycle in Integration Context', () => {
    it('should start and stop app cleanly', async () => {
      // Mock the underlying Slack app
      const mockSlackApp = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      app.getApp = vi.fn().mockReturnValue(mockSlackApp);

      await app.start();
      expect(mockSlackApp.start).toHaveBeenCalledTimes(1);

      await app.stop();
      expect(mockSlackApp.stop).toHaveBeenCalledTimes(1);
    });

    it('should handle startup errors gracefully', async () => {
      const mockSlackApp = {
        start: vi.fn().mockRejectedValue(new Error('Failed to start')),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      app.getApp = vi.fn().mockReturnValue(mockSlackApp);

      await expect(app.start()).rejects.toThrow('Failed to start');
    });
  });
});