/**
 * Unit Tests for JUnitIngestionService
 * 
 * Comprehensive test suite covering:
 * - Various Surefire and other JUnit formats
 * - Mock GitHub API responses and artifact handling
 * - Error scenarios (network failures, malformed XML, large files)
 * - Performance tests for large XML processing
 * - Event emission and progress tracking
 * - Retry logic and timeout handling
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable, Transform } from 'stream';

import { 
  JUnitIngestionService, 
  createIngestionService,
  ingestJUnitArtifacts,
  ingestFromGitHubArtifacts
} from '../junit.js';
import type {
  IngestionParameters,
  IngestionResult,
  ArtifactSource,
  RepositoryContext,
  RetryConfig,
  IngestionError,
  FileProcessingResult
} from '../types.js';
import {
  IngestionException,
  DownloadFailedException,
  ParsingFailedException,
  TimeoutException
} from '../types.js';

// Mock external dependencies
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      unlink: vi.fn(),
      mkdir: vi.fn()
    }
  };
});

vi.mock('../parsers/junit-parser.js', () => ({
  parseJUnitXMLFile: vi.fn(),
  parseJUnitXML: vi.fn(),
  detectJUnitFormat: vi.fn()
}));

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual('../utils.js');
  return {
    ...actual,
    generateCorrelationId: vi.fn(() => 'test-correlation-id'),
    ensureDirectoryExists: vi.fn(),
    cleanupTempFiles: vi.fn(),
    createRetryableFetch: vi.fn(),
    createSizeLimiter: vi.fn(),
    createTimeoutStream: vi.fn()
  };
});

// ============================================================================
// Test Setup and Helpers
// ============================================================================

describe('JUnitIngestionService', () => {
  let service: JUnitIngestionService;
  let mockLogger: Console;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = join(tmpdir(), 'junit-ingestion-tests', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });
  });

  beforeEach(() => {
    mockLogger = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as any;

    service = new JUnitIngestionService(mockLogger);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    service.removeAllListeners();
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============================================================================
  // Constructor and Basic Functionality Tests
  // ============================================================================

  describe('Constructor', () => {
    it('should create service with default logger when none provided', () => {
      const defaultService = new JUnitIngestionService();
      expect(defaultService).toBeInstanceOf(JUnitIngestionService);
      expect(defaultService).toBeInstanceOf(EventEmitter);
    });

    it('should create service with custom logger', () => {
      const customLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
      const customService = new JUnitIngestionService(customLogger);
      expect(customService).toBeInstanceOf(JUnitIngestionService);
    });

    it('should be an event emitter', () => {
      expect(service).toBeInstanceOf(EventEmitter);
    });
  });

  // ============================================================================
  // Configuration Validation Tests
  // ============================================================================

  describe('Configuration Validation', () => {
    const validRepository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    const validArtifacts: ArtifactSource[] = [{
      name: 'test-results.xml',
      url: 'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
      downloadUrl: 'https://github.com/test/repo/actions/artifacts/123.zip',
      size: 1024,
      expiresAt: new Date(Date.now() + 60000)
    }];

    it('should validate required repository fields', async () => {
      const parameters: IngestionParameters = {
        config: {
          repository: { owner: '', repo: 'test-repo' },
          artifacts: validArtifacts
        }
      };

      const result = await service.ingest(parameters);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('VALIDATION_FAILED');
      expect(result.errors[0].message).toContain('Repository owner and name are required');
    });

    it('should validate artifacts array is not empty', async () => {
      const parameters: IngestionParameters = {
        config: {
          repository: validRepository,
          artifacts: []
        }
      };

      const result = await service.ingest(parameters);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('VALIDATION_FAILED');
      expect(result.errors[0].message).toContain('At least one artifact is required');
    });

    it('should validate timeout is positive', async () => {
      const parameters: IngestionParameters = {
        config: {
          repository: validRepository,
          artifacts: validArtifacts,
          timeoutMs: -1000
        }
      };

      const result = await service.ingest(parameters);
      
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('Timeout must be positive');
    });

    it('should validate max file size is positive', async () => {
      const parameters: IngestionParameters = {
        config: {
          repository: validRepository,
          artifacts: validArtifacts,
          maxFileSizeBytes: -1
        }
      };

      const result = await service.ingest(parameters);
      
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('Max file size must be positive');
    });

    it('should validate concurrency range', async () => {
      const parameters: IngestionParameters = {
        config: {
          repository: validRepository,
          artifacts: validArtifacts,
          concurrency: 15
        }
      };

      const result = await service.ingest(parameters);
      
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('Concurrency must be between 1 and 10');
    });
  });

  // ============================================================================
  // Artifact Filtering Tests
  // ============================================================================

  describe('Artifact Filtering', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    it('should filter out invalid artifacts', async () => {
      const artifacts: ArtifactSource[] = [
        {
          name: 'valid-results.xml',
          url: 'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
          size: 1024
        },
        {
          name: '', // Invalid - empty name
          url: 'https://api.github.com/repos/test/repo/actions/artifacts/124/zip',
          size: 1024
        },
        {
          name: 'too-large.xml',
          url: 'https://api.github.com/repos/test/repo/actions/artifacts/125/zip',
          size: 200 * 1024 * 1024 // 200MB - exceeds default 100MB limit
        }
      ];

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      // Mock the parsing to avoid actual file operations
      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Test Suite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: []
        },
        format: 'surefire',
        warnings: []
      });

      const result = await service.ingest(parameters);

      // Should warn about filtered artifacts
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No valid artifacts found to process'
      );
      expect(result.results).toHaveLength(0);
    });

    it('should process valid artifacts only', async () => {
      const artifacts: ArtifactSource[] = [
        {
          name: 'test-results.xml',
          url: 'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
          size: 1024
        }
      ];

      // Mock successful download and parsing
      vi.mocked(createWriteStream).mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        body: new Readable({
          read() {
            this.push('mock xml content');
            this.push(null);
          }
        }),
        ok: true
      });

      const { createRetryableFetch } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Processing artifact: test-results.xml')
      );
    });
  });

  // ============================================================================
  // Download Handling Tests
  // ============================================================================

  describe('Download Handling', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    beforeEach(() => {
      // Mock file system operations
      vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);
      vi.mocked(createWriteStream).mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        once: vi.fn()
      } as any);
    });

    it('should handle successful artifact download', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'test-results.xml',
        url: 'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
        size: 1024
      }];

      const mockResponse = {
        ok: true,
        body: new Readable({
          read() {
            this.push('<testsuite name="test" tests="1" failures="0"><testcase name="test1" classname="TestClass"/></testsuite>');
            this.push(null);
          }
        })
      };

      const mockFetch = vi.fn().mockResolvedValue(mockResponse);
      const { createRetryableFetch, createSizeLimiter, createTimeoutStream } = await import('../utils.js');
      
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);
      vi.mocked(createSizeLimiter).mockReturnValue(new Transform({ 
        transform(chunk, encoding, callback) { 
          callback(null, chunk); 
        } 
      }));
      vi.mocked(createTimeoutStream).mockReturnValue(new Transform({ 
        transform(chunk, encoding, callback) { 
          callback(null, chunk); 
        } 
      }));

      // Mock parsing
      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Test Suite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: [{
            name: 'TestSuite',
            tests: 1,
            failures: 0,
            errors: 0,
            skipped: 0,
            testCases: [{
              name: 'test1',
              className: 'TestClass',
              status: 'passed'
            }]
          }]
        },
        format: 'surefire',
        warnings: []
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      const result = await service.ingest(parameters);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      );
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
    });

    it('should handle download failures with retry', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'test-results.xml',
        url: 'https://invalid-url',
        size: 1024
      }];

      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));

      const { createRetryableFetch } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        type: 'DOWNLOAD_FAILED',
        fileName: 'test-results.xml'
      });
    });

    it('should handle expired artifact URLs', async () => {
      const expiredArtifacts: ArtifactSource[] = [{
        name: 'expired-results.xml',
        url: 'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
        size: 1024,
        expiresAt: new Date(Date.now() - 60000) // Expired 1 minute ago
      }];

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts: expiredArtifacts
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('DOWNLOAD_FAILED');
      expect(result.errors[0].message).toContain('expired');
    });

    it('should handle file size limits', async () => {
      const largeArtifacts: ArtifactSource[] = [{
        name: 'large-results.xml',
        url: 'https://api.github.com/repos/test/repo/actions/artifacts/123/zip',
        size: 1024
      }];

      const mockResponse = {
        ok: true,
        body: new Readable({
          read() {
            // Simulate large file that exceeds size limit
            this.push(Buffer.alloc(1024 * 1024, 'x')); // 1MB chunk
            this.push(null);
          }
        })
      };

      const mockFetch = vi.fn().mockResolvedValue(mockResponse);
      const { createRetryableFetch, createSizeLimiter } = await import('../utils.js');
      
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);
      // Mock size limiter that throws error
      vi.mocked(createSizeLimiter).mockReturnValue(new Transform({
        transform(chunk, encoding, callback) {
          callback(new Error('File size limit exceeded'));
        }
      }));

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts: largeArtifacts,
          maxFileSizeBytes: 512 * 1024 // 512KB limit
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('DOWNLOAD_FAILED');
    });
  });

  // ============================================================================
  // Parsing Tests
  // ============================================================================

  describe('XML Parsing', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    beforeEach(() => {
      // Mock successful download
      vi.mocked(createWriteStream).mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as any);

      vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: new Readable({ read() { this.push(null); } })
      });
      
      const { createRetryableFetch } = import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);
    });

    it('should handle successful Surefire XML parsing', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'surefire-results.xml',
        url: 'https://api.github.com/test.xml',
        size: 1024
      }];

      const expectedResult = {
        testSuites: {
          name: 'Surefire Test Suite',
          tests: 5,
          failures: 1,
          errors: 0,
          skipped: 1,
          suites: [{
            name: 'com.example.TestSuite',
            tests: 5,
            failures: 1,
            errors: 0,
            skipped: 1,
            testCases: [
              { name: 'test1', className: 'com.example.TestSuite', status: 'passed' },
              { name: 'test2', className: 'com.example.TestSuite', status: 'failed', failure: { message: 'assertion failed' } },
              { name: 'test3', className: 'com.example.TestSuite', status: 'skipped', skipped: { message: 'test disabled' } }
            ]
          }]
        },
        format: 'surefire' as const,
        warnings: []
      };

      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue(expectedResult);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts,
          expectedFormat: 'surefire'
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].format).toBe('surefire');
      expect(result.results[0].testSuites.tests).toBe(5);
      expect(result.stats.totalTests).toBe(5);
      expect(result.stats.totalFailures).toBe(1);
      expect(result.stats.totalSkipped).toBe(1);
    });

    it('should handle malformed XML parsing errors', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'malformed.xml',
        url: 'https://api.github.com/malformed.xml',
        size: 1024
      }];

      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockRejectedValue(
        new ParsingFailedException('Invalid XML: Unexpected token', 'malformed.xml')
      );

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('PARSING_FAILED');
      expect(result.errors[0].fileName).toBe('malformed.xml');
    });

    it('should handle different JUnit formats', async () => {
      const formats = ['gradle', 'jest', 'pytest', 'phpunit'] as const;
      
      for (const format of formats) {
        const artifacts: ArtifactSource[] = [{
          name: `${format}-results.xml`,
          url: `https://api.github.com/${format}.xml`,
          size: 1024
        }];

        const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
        vi.mocked(parseJUnitXMLFile).mockResolvedValue({
          testSuites: {
            name: `${format} Test Suite`,
            tests: 3,
            failures: 0,
            errors: 0,
            skipped: 0,
            suites: []
          },
          format,
          warnings: []
        });

        const parameters: IngestionParameters = {
          config: {
            repository,
            artifacts,
            expectedFormat: format
          }
        };

        const result = await service.ingest(parameters);

        expect(result.success).toBe(true);
        expect(result.results[0].format).toBe(format);
      }
    });
  });

  // ============================================================================
  // Event Emission Tests
  // ============================================================================

  describe('Event Emission', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    beforeEach(() => {
      // Mock successful operations
      vi.mocked(createWriteStream).mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as any);

      vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: new Readable({ read() { this.push(null); } })
      });
      
      const { createRetryableFetch } = import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const { parseJUnitXMLFile } = import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Test Suite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: []
        },
        format: 'surefire',
        warnings: []
      });
    });

    it('should emit progress events during ingestion', async () => {
      const artifacts: ArtifactSource[] = [
        { name: 'test1.xml', url: 'https://api.github.com/test1.xml', size: 1024 },
        { name: 'test2.xml', url: 'https://api.github.com/test2.xml', size: 1024 }
      ];

      const progressEvents: any[] = [];
      service.on('progress', (progress) => {
        progressEvents.push(progress);
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(progressEvents).toHaveLength(3); // download, parse, complete
      expect(progressEvents[0]).toMatchObject({
        phase: 'download',
        processed: 0,
        total: 2
      });
      expect(progressEvents[2]).toMatchObject({
        phase: 'complete',
        processed: 2,
        total: 2
      });
    });

    it('should emit artifact-processed events', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'test.xml',
        url: 'https://api.github.com/test.xml',
        size: 1024
      }];

      const processedEvents: FileProcessingResult[] = [];
      service.on('artifact-processed', (result) => {
        processedEvents.push(result);
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(processedEvents).toHaveLength(1);
      expect(processedEvents[0]).toMatchObject({
        fileName: expect.any(String),
        format: 'surefire',
        testSuites: expect.any(Object)
      });
    });

    it('should emit error events for failures', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'failing.xml',
        url: 'https://invalid-url',
        size: 1024
      }];

      const errorEvents: IngestionError[] = [];
      service.on('error', (error) => {
        errorEvents.push(error);
      });

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const { createRetryableFetch } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        type: 'DOWNLOAD_FAILED',
        fileName: 'failing.xml'
      });
    });

    it('should emit warning events for filtered artifacts', async () => {
      const artifacts: ArtifactSource[] = [{
        name: '', // Invalid artifact name
        url: 'https://api.github.com/test.xml',
        size: 1024
      }];

      const warningEvents: any[] = [];
      service.on('warning', (warning, context) => {
        warningEvents.push({ warning, context });
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(warningEvents.length).toBeGreaterThan(0);
      expect(warningEvents[0].warning).toContain('Invalid artifact');
    });
  });

  // ============================================================================
  // Concurrency Tests
  // ============================================================================

  describe('Concurrency Control', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    it('should process artifacts with configured concurrency', async () => {
      const artifacts: ArtifactSource[] = Array.from({ length: 6 }, (_, i) => ({
        name: `test${i}.xml`,
        url: `https://api.github.com/test${i}.xml`,
        size: 1024
      }));

      const processingTimes: number[] = [];
      let concurrentCount = 0;
      let maxConcurrent = 0;

      // Mock processing with delays to test concurrency
      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing time
        
        concurrentCount--;
        return {
          testSuites: {
            name: 'Test Suite',
            tests: 1,
            failures: 0,
            errors: 0,
            skipped: 0,
            suites: []
          },
          format: 'surefire',
          warnings: []
        };
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts,
          concurrency: 3 // Process 3 at a time
        }
      };

      const startTime = Date.now();
      await service.ingest(parameters);
      const endTime = Date.now();

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(endTime - startTime).toBeLessThan(1000); // Should be faster than sequential
    });
  });

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('Performance Tests', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    it('should handle large XML files efficiently', async () => {
      const largeArtifacts: ArtifactSource[] = [{
        name: 'large-test-results.xml',
        url: 'https://api.github.com/large.xml',
        size: 50 * 1024 * 1024 // 50MB
      }];

      // Mock parsing of large file
      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Large Test Suite',
          tests: 10000,
          failures: 100,
          errors: 50,
          skipped: 200,
          suites: Array.from({ length: 100 }, (_, i) => ({
            name: `TestSuite${i}`,
            tests: 100,
            failures: 1,
            errors: 0,
            skipped: 2,
            testCases: Array.from({ length: 100 }, (_, j) => ({
              name: `test${j}`,
              className: `TestClass${i}`,
              status: j % 100 === 0 ? 'failed' : (j % 50 === 0 ? 'skipped' : 'passed')
            }))
          }))
        },
        format: 'surefire',
        warnings: []
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts: largeArtifacts
        }
      };

      const startTime = Date.now();
      const result = await service.ingest(parameters);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.stats.totalTests).toBe(10000);
      expect(result.stats.processingTimeMs).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle memory efficiently with streaming', async () => {
      const artifacts: ArtifactSource[] = Array.from({ length: 20 }, (_, i) => ({
        name: `batch${i}.xml`,
        url: `https://api.github.com/batch${i}.xml`,
        size: 5 * 1024 * 1024 // 5MB each
      }));

      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Batch Test Suite',
          tests: 100,
          failures: 5,
          errors: 2,
          skipped: 10,
          suites: []
        },
        format: 'surefire',
        warnings: []
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts,
          concurrency: 5,
          streamingEnabled: true
        }
      };

      const initialMemory = process.memoryUsage().heapUsed;
      const result = await service.ingest(parameters);
      const finalMemory = process.memoryUsage().heapUsed;

      expect(result.success).toBe(true);
      // Memory usage shouldn't grow dramatically with streaming enabled
      expect(finalMemory - initialMemory).toBeLessThan(100 * 1024 * 1024); // Less than 100MB increase
    });
  });

  // ============================================================================
  // Error Recovery Tests
  // ============================================================================

  describe('Error Recovery', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    it('should continue processing after individual failures', async () => {
      const artifacts: ArtifactSource[] = [
        { name: 'good1.xml', url: 'https://api.github.com/good1.xml', size: 1024 },
        { name: 'bad.xml', url: 'https://invalid-url', size: 1024 },
        { name: 'good2.xml', url: 'https://api.github.com/good2.xml', size: 1024 }
      ];

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, body: new Readable({ read() { this.push(null); } }) })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true, body: new Readable({ read() { this.push(null); } }) });

      const { createRetryableFetch } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Test Suite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: []
        },
        format: 'surefire',
        warnings: []
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      const result = await service.ingest(parameters);

      expect(result.results).toHaveLength(2); // Should process 2 successful artifacts
      expect(result.errors).toHaveLength(1); // Should have 1 error
      expect(result.success).toBe(false); // Overall failure due to error
    });
  });

  // ============================================================================
  // Convenience Functions Tests
  // ============================================================================

  describe('Convenience Functions', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    const artifacts: ArtifactSource[] = [{
      name: 'test.xml',
      url: 'https://api.github.com/test.xml',
      size: 1024
    }];

    beforeEach(() => {
      // Mock successful operations for convenience function tests
      vi.mocked(createWriteStream).mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn()
      } as any);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: new Readable({ read() { this.push(null); } })
      });
      
      const { createRetryableFetch } = import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const { parseJUnitXMLFile } = import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Test Suite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: []
        },
        format: 'surefire',
        warnings: []
      });
    });

    it('should create service with createIngestionService', () => {
      const customLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
      const service = createIngestionService(customLogger);
      
      expect(service).toBeInstanceOf(JUnitIngestionService);
      expect(service).toBeInstanceOf(EventEmitter);
    });

    it('should ingest artifacts with ingestJUnitArtifacts', async () => {
      const result = await ingestJUnitArtifacts(artifacts, repository, {
        expectedFormat: 'surefire',
        logger: mockLogger
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
    });

    it('should ingest from GitHub URLs with ingestFromGitHubArtifacts', async () => {
      const urls = ['https://api.github.com/test1.xml', 'https://api.github.com/test2.xml'];
      
      const result = await ingestFromGitHubArtifacts(urls, repository, {
        expectedFormat: 'gradle',
        logger: mockLogger
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });
  });

  // ============================================================================
  // Timeout and Retry Tests
  // ============================================================================

  describe('Timeout and Retry Logic', () => {
    const repository: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    it('should respect timeout configuration', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'slow.xml',
        url: 'https://api.github.com/slow.xml',
        size: 1024
      }];

      const slowFetch = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        return { ok: true, body: new Readable({ read() { this.push(null); } }) };
      });

      const { createRetryableFetch } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(slowFetch);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts,
          timeoutMs: 1000 // 1 second timeout
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(false);
      expect(result.errors[0].type).toBe('DOWNLOAD_FAILED');
    });

    it('should use custom retry configuration', async () => {
      const artifacts: ArtifactSource[] = [{
        name: 'retry-test.xml',
        url: 'https://api.github.com/retry.xml',
        size: 1024
      }];

      const retryConfig: RetryConfig = {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 1.5,
        jitterEnabled: false
      };

      let attemptCount = 0;
      const flakyFetch = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return { ok: true, body: new Readable({ read() { this.push(null); } }) };
      });

      const { createRetryableFetch } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(flakyFetch);

      const { parseJUnitXMLFile } = await import('../parsers/junit-parser.js');
      vi.mocked(parseJUnitXMLFile).mockResolvedValue({
        testSuites: {
          name: 'Test Suite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: []
        },
        format: 'surefire',
        warnings: []
      });

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts,
          retryConfig
        }
      };

      const result = await service.ingest(parameters);

      expect(result.success).toBe(true);
      expect(flakyFetch).toHaveBeenCalledTimes(3); // Should retry 3 times total
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  describe('Cleanup', () => {
    it('should cleanup temporary files after processing', async () => {
      const repository: RepositoryContext = {
        owner: 'test-owner',
        repo: 'test-repo'
      };

      const artifacts: ArtifactSource[] = [{
        name: 'cleanup-test.xml',
        url: 'https://api.github.com/test.xml',
        size: 1024
      }];

      const { cleanupTempFiles } = await import('../utils.js');
      const cleanupSpy = vi.mocked(cleanupTempFiles);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(cleanupSpy).toHaveBeenCalledWith(expect.any(Array));
    });

    it('should cleanup even when processing fails', async () => {
      const repository: RepositoryContext = {
        owner: 'test-owner',
        repo: 'test-repo'
      };

      const artifacts: ArtifactSource[] = [{
        name: 'failing.xml',
        url: 'https://invalid-url',
        size: 1024
      }];

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const { createRetryableFetch, cleanupTempFiles } = await import('../utils.js');
      vi.mocked(createRetryableFetch).mockReturnValue(mockFetch);

      const cleanupSpy = vi.mocked(cleanupTempFiles);

      const parameters: IngestionParameters = {
        config: {
          repository,
          artifacts
        }
      };

      await service.ingest(parameters);

      expect(cleanupSpy).toHaveBeenCalledWith(expect.any(Array));
    });
  });
});