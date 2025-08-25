/**
 * Comprehensive unit tests for FlakeGuard Slack App
 * 
 * Tests cover:
 * - Slash command handling (/flakeguard status, topflaky, help)
 * - Block Kit button interactions (quarantine, open issue)
 * - Error handling and rate limiting
 * - Integration with backend GitHub handlers
 * - Message formatting and response validation
 */

import { TestCrypto } from '@flakeguard/shared/utils';
import { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FlakinessScorer } from '../../analytics/flakiness.js';
import { GitHubAuthManager } from '../../github/auth.js';
import { CheckRunHandler } from '../../github/handlers.js';
import { FlakeGuardSlackApp, createFlakeGuardSlackApp } from '../app.js';

// Mock all dependencies
vi.mock('@slack/bolt', () => ({
  App: vi.fn()
}));
vi.mock('@prisma/client');
vi.mock('../../github/auth.js');
vi.mock('../../github/handlers.js');
vi.mock('../../analytics/flakiness.js');
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}));

describe('FlakeGuardSlackApp', () => {
  let app: FlakeGuardSlackApp;
  let mockPrisma: any;
  let mockGithubAuth: any;
  let mockCheckRunHandler: any;
  let mockFlakinessScorer: any;
  let mockSlackApp: any;
  let mockRespond: any;
  let mockAck: any;

  const mockConfig = {
    signingSecret: TestCrypto.generateSlackSigningSecret(),
    token: TestCrypto.generateBotToken(),
    port: 3001
  };

  const mockSlackBody = {
    user_id: 'U12345',
    channel_id: 'C12345',
    team_id: 'T12345',
    channel_name: 'general',
    text: ''
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock Prisma client
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

    // Mock GitHub Auth Manager
    mockGithubAuth = {
      getInstallationOctokit: vi.fn(),
    };

    // Mock Check Run Handler
    mockCheckRunHandler = {
      process: vi.fn(),
    };

    // Mock Flakiness Scorer
    mockFlakinessScorer = {
      computeFlakeScore: vi.fn(),
    };

    // Mock Slack App
    mockSlackApp = {
      command: vi.fn(),
      action: vi.fn(),
      error: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      receiver: {
        app: {
          use: vi.fn(),
        }
      }
    };

    mockRespond = vi.fn();
    mockAck = vi.fn();

    // Mock @slack/bolt App constructor
    const { App } = await import('@slack/bolt');
    vi.mocked(App).mockImplementation(() => mockSlackApp);

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
  });

  describe('Initialization', () => {
    it('should create Slack app with correct configuration', () => {
      const { App } = require('@slack/bolt');
      
      expect(App).toHaveBeenCalledWith({
        signingSecret: mockConfig.signingSecret,
        token: mockConfig.token,
        port: mockConfig.port,
        processBeforeResponse: true,
        customRoutes: expect.arrayContaining([
          expect.objectContaining({
            path: '/health',
            method: ['GET'],
            handler: expect.any(Function)
          })
        ]),
        errorHandler: expect.any(Function)
      });
    });

    it('should setup slash commands', () => {
      expect(mockSlackApp.command).toHaveBeenCalledWith('/flakeguard', expect.any(Function));
    });

    it('should setup block actions', () => {
      expect(mockSlackApp.action).toHaveBeenCalledWith('quarantine_test', expect.any(Function));
      expect(mockSlackApp.action).toHaveBeenCalledWith('open_issue', expect.any(Function));
      expect(mockSlackApp.action).toHaveBeenCalledWith('view_details', expect.any(Function));
    });

    it('should setup error handling', () => {
      expect(mockSlackApp.error).toHaveBeenCalledWith(expect.any(Function));
      expect(mockSlackApp.receiver.app.use).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('Slash Commands', () => {
    describe('/flakeguard help', () => {
      it('should show help message for help command', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'help' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: expect.stringContaining('FlakeGuard Slack Bot')
              }
            })
          ]),
          response_type: 'ephemeral'
        });
      });

      it('should show help message for empty command', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: '' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('FlakeGuard Slack Bot')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });
    });

    describe('/flakeguard status', () => {
      it('should return error for missing repository', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'status' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('Please provide a repository'),
          response_type: 'ephemeral'
        });
      });

      it('should return error for invalid repository format', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'status invalid-format' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('Invalid repository format'),
          response_type: 'ephemeral'
        });
      });

      it('should return error for repository not found', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        mockPrisma.repository.findFirst.mockResolvedValue(null);
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'status microsoft/typescript' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockPrisma.repository.findFirst).toHaveBeenCalledWith({
          where: { fullName: 'microsoft/typescript' },
          select: { id: true, fullName: true, name: true }
        });
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('Repository `microsoft/typescript` not found'),
          response_type: 'ephemeral'
        });
      });

      it('should return repository status with flaky tests', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        const mockRepository = {
          id: 'repo-123',
          fullName: 'microsoft/typescript',
          name: 'typescript'
        };

        const mockTestResults = [
          {
            testFullName: 'test1.spec.ts::should work',
            name: 'should work',
            status: 'failed',
            message: 'Test failed',
            time: 1000,
            attempt: 1,
            runId: 'run-1',
            createdAt: new Date()
          },
          {
            testFullName: 'test1.spec.ts::should work',
            name: 'should work',
            status: 'passed',
            message: null,
            time: 950,
            attempt: 1,
            runId: 'run-2',
            createdAt: new Date()
          }
        ];

        const mockFlakeScore = {
          score: 0.8,
          features: {
            failSuccessRatio: 0.5,
            totalRuns: 2,
            recentFailures: 1
          },
          recommendation: {
            action: 'quarantine',
            priority: 'high'
          }
        };

        mockPrisma.repository.findFirst.mockResolvedValue(mockRepository);
        mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
        mockPrisma.testResult.findMany.mockResolvedValue(mockTestResults);
        mockFlakinessScorer.computeFlakeScore.mockReturnValue(mockFlakeScore);
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'status microsoft/typescript' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('FlakeGuard Status: microsoft/typescript')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });

      it('should show healthy status when no flaky tests found', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        const mockRepository = {
          id: 'repo-123',
          fullName: 'microsoft/typescript',
          name: 'typescript'
        };

        mockPrisma.repository.findFirst.mockResolvedValue(mockRepository);
        mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
        mockPrisma.testResult.findMany.mockResolvedValue([]);
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'status microsoft/typescript' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('No flaky tests detected')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });
    });

    describe('/flakeguard topflaky', () => {
      it('should return top flaky tests across all repositories', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        
        const mockFlakeDetections = [
          {
            testName: 'flaky-test-1',
            confidence: 0.9,
            failureRate: 0.6,
            lastUpdatedAt: new Date(),
            repository: { fullName: 'org/repo1' }
          },
          {
            testName: 'flaky-test-2',
            confidence: 0.8,
            failureRate: 0.4,
            lastUpdatedAt: new Date(),
            repository: { fullName: 'org/repo2' }
          }
        ];

        mockPrisma.flakeDetection.findMany.mockResolvedValue(mockFlakeDetections);
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'topflaky' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Top 2 Flakiest Tests')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });

      it('should handle custom limit for top flaky', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        mockPrisma.flakeDetection.findMany.mockResolvedValue([]);
        
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'topflaky 5' },
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('No flaky tests detected'),
          response_type: 'ephemeral'
        });
      });

      it('should clamp limit between 1 and 25', async () => {
        const commandHandler = mockSlackApp.command.mock.calls[0][1];
        mockPrisma.flakeDetection.findMany.mockResolvedValue([]);
        
        // Test limit clamping by checking database call
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'topflaky 100' },
          respond: mockRespond,
          client: {}
        });

        expect(mockPrisma.flakeDetection.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            take: 50 // 25 * 2 (limit is clamped to 25, then doubled for filtering)
          })
        );
      });
    });
  });

  describe('Block Actions', () => {
    const mockButtonAction = {
      user: { id: 'U12345' },
      actions: [{
        value: JSON.stringify({
          repositoryId: 'repo-123',
          testName: 'flaky-test'
        })
      }]
    };

    describe('Quarantine Action', () => {
      it('should successfully quarantine test', async () => {
        const actionHandler = mockSlackApp.action.mock.calls.find(
          call => call[0] === 'quarantine_test'
        )[1];

        const mockRepository = {
          id: 'repo-123',
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          installationId: '123'
        };

        const mockFlakeDetection = {
          testName: 'flaky-test',
          repositoryId: 'repo-123'
        };

        mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
        mockPrisma.flakeDetection.findFirst.mockResolvedValue(mockFlakeDetection);
        mockCheckRunHandler.process.mockResolvedValue({});

        await actionHandler({
          ack: mockAck,
          body: mockButtonAction,
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockCheckRunHandler.process).toHaveBeenCalledWith(
          expect.objectContaining({
            requested_action: { identifier: 'quarantine' }
          })
        );
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('✅ Quarantine Successful'),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Quarantine Completed')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });

      it('should handle quarantine failure', async () => {
        const actionHandler = mockSlackApp.action.mock.calls.find(
          call => call[0] === 'quarantine_test'
        )[1];

        mockPrisma.repository.findUnique.mockResolvedValue(null);

        await actionHandler({
          ack: mockAck,
          body: mockButtonAction,
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('❌ Quarantine Failed'),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Repository not found')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });
    });

    describe('Open Issue Action', () => {
      it('should successfully create issue', async () => {
        const actionHandler = mockSlackApp.action.mock.calls.find(
          call => call[0] === 'open_issue'
        )[1];

        const mockRepository = {
          id: 'repo-123',
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          installationId: '123'
        };

        mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
        mockCheckRunHandler.process.mockResolvedValue({});

        await actionHandler({
          ack: mockAck,
          body: mockButtonAction,
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockCheckRunHandler.process).toHaveBeenCalledWith(
          expect.objectContaining({
            requested_action: { identifier: 'open_issue' }
          })
        );
        expect(mockRespond).toHaveBeenCalledWith({
          text: expect.stringContaining('✅ Issue Creation Successful'),
          response_type: 'ephemeral'
        });
      });
    });

    describe('View Details Action', () => {
      it('should show test details', async () => {
        const actionHandler = mockSlackApp.action.mock.calls.find(
          call => call[0] === 'view_details'
        )[1];

        const mockRepository = {
          fullName: 'org/repo'
        };

        const mockTestResults = [
          { status: 'passed', time: 1000, createdAt: new Date() },
          { status: 'failed', time: 1200, createdAt: new Date() }
        ];

        mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
        mockPrisma.testResult.findMany.mockResolvedValue(mockTestResults);

        await actionHandler({
          ack: mockAck,
          body: mockButtonAction,
          respond: mockRespond,
          client: {}
        });

        expect(mockAck).toHaveBeenCalled();
        expect(mockRespond).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                text: expect.stringContaining('Test Details:')
              })
            })
          ]),
          response_type: 'ephemeral'
        });
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      const commandHandler = mockSlackApp.command.mock.calls[0][1];
      
      await commandHandler({
        ack: mockAck,
        body: { ...mockSlackBody, text: 'help' },
        respond: mockRespond,
        client: {}
      });

      expect(mockRespond).toHaveBeenCalledWith({
        blocks: expect.any(Array),
        response_type: 'ephemeral'
      });
    });

    it('should block requests exceeding rate limit', async () => {
      const commandHandler = mockSlackApp.command.mock.calls[0][1];
      
      // Simulate multiple rapid requests from same user
      for (let i = 0; i < 12; i++) {
        await commandHandler({
          ack: mockAck,
          body: { ...mockSlackBody, text: 'help' },
          respond: mockRespond,
          client: {}
        });
      }

      // Last calls should be rate limited
      expect(mockRespond).toHaveBeenLastCalledWith({
        text: expect.stringContaining('Rate limit exceeded'),
        response_type: 'ephemeral'
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const commandHandler = mockSlackApp.command.mock.calls[0][1];
      mockPrisma.repository.findFirst.mockRejectedValue(new Error('Database error'));
      
      await commandHandler({
        ack: mockAck,
        body: { ...mockSlackBody, text: 'status microsoft/typescript' },
        respond: mockRespond,
        client: {}
      });

      expect(mockAck).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        text: expect.stringContaining('❌ An error occurred'),
        response_type: 'ephemeral'
      });
    });

    it('should handle GitHub API errors gracefully', async () => {
      const actionHandler = mockSlackApp.action.mock.calls.find(
        call => call[0] === 'quarantine_test'
      )[1];

      const mockRepository = {
        id: 'repo-123',
        fullName: 'org/repo',
        owner: 'org',
        name: 'repo',
        installationId: '123'
      };

      mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
      mockPrisma.flakeDetection.findFirst.mockResolvedValue({ testName: 'test' });
      mockCheckRunHandler.process.mockRejectedValue(new Error('GitHub API error'));

      await actionHandler({
        ack: mockAck,
        body: mockButtonAction,
        respond: mockRespond,
        client: {}
      });

      expect(mockRespond).toHaveBeenCalledWith({
        text: expect.stringContaining('❌ Failed to quarantine test'),
        response_type: 'ephemeral'
      });
    });
  });

  describe('App Lifecycle', () => {
    it('should start app successfully', async () => {
      mockSlackApp.start.mockResolvedValue(undefined);
      
      await app.start();
      
      expect(mockSlackApp.start).toHaveBeenCalled();
    });

    it('should stop app successfully', async () => {
      mockSlackApp.stop.mockResolvedValue(undefined);
      
      await app.stop();
      
      expect(mockSlackApp.stop).toHaveBeenCalled();
    });

    it('should handle start errors', async () => {
      mockSlackApp.start.mockRejectedValue(new Error('Start error'));
      
      await expect(app.start()).rejects.toThrow('Start error');
    });

    it('should return underlying app instance', () => {
      expect(app.getApp()).toBe(mockSlackApp);
    });
  });

  describe('Utility Functions', () => {
    it('should create app instance using factory function', () => {
      const factoryApp = createFlakeGuardSlackApp(mockConfig, {
        prisma: mockPrisma,
        githubAuth: mockGithubAuth,
        checkRunHandler: mockCheckRunHandler,
        flakinessScorer: mockFlakinessScorer,
      });

      expect(factoryApp).toBeInstanceOf(FlakeGuardSlackApp);
    });

    it('should validate health score calculation', async () => {
      // Test health score calculation through status command
      const commandHandler = mockSlackApp.command.mock.calls[0][1];
      
      const mockRepository = {
        id: 'repo-123',
        fullName: 'microsoft/typescript',
        name: 'typescript'
      };

      // Mock scenario with 10% flaky tests (should give 90% health score)
      const mockTestResults = Array.from({ length: 10 }, (_, i) => ({
        testFullName: `test${i}.spec.ts::should work`,
        name: `should work ${i}`,
        status: i === 0 ? 'failed' : 'passed', // Only first test is flaky
        message: null,
        time: 1000,
        attempt: 1,
        runId: `run-${i}`,
        createdAt: new Date()
      }));

      mockPrisma.repository.findFirst.mockResolvedValue(mockRepository);
      mockPrisma.repository.findUnique.mockResolvedValue(mockRepository);
      mockPrisma.testResult.findMany.mockResolvedValue(mockTestResults);
      
      // Only one test is flaky (10% of tests)
      mockFlakinessScorer.computeFlakeScore
        .mockReturnValueOnce({
          score: 0.8,
          features: { failSuccessRatio: 0.5, totalRuns: 2, recentFailures: 1 },
          recommendation: { action: 'quarantine', priority: 'high' }
        });
      
      await commandHandler({
        ack: mockAck,
        body: { ...mockSlackBody, text: 'status microsoft/typescript' },
        respond: mockRespond,
        client: {}
      });

      const response = mockRespond.mock.calls[0][0];
      const healthField = response.blocks.find((block: any) => 
        block.fields?.some((field: any) => field.text.includes('Health Score:'))
      )?.fields?.find((field: any) => field.text.includes('Health Score:'));

      expect(healthField?.text).toContain('90%'); // 100% - 10% flaky = 90%
      expect(healthField?.text).toContain('🟢'); // Should be green for 90%+
    });
  });
});