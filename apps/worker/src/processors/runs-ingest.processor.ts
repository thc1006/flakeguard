/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, import/order, import/no-duplicates */

/**
 * Workflow Runs Ingestion Processor
 * 
 * Processes workflow run completion events, downloads artifacts,
 * parses JUnit test results, and stores them in the database with
 * comprehensive error handling and retry mechanisms.
 */

import { Job } from 'bullmq';
import { PrismaClient, Prisma } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { createReadStream, createWriteStream, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import * as sax from 'sax';
import StreamZip from 'node-stream-zip';
import { logger } from '../utils/logger.js';
import { 
  recordJobCompletion, 
  recordGitHubApiCall,
  artifactProcessingTime,
  artifactSize,
  artifactsProcessed,
  testResultsParsed
} from '../utils/metrics.js';
import { 
  ARTIFACT_FILTERS,
  QueueNames 
} from '@flakeguard/shared';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface RunsIngestJobData {
  workflowRunId: number;
  repository: {
    owner: string;
    repo: string;
    installationId: number;
  };
  correlationId?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  triggeredBy?: 'webhook' | 'polling' | 'manual';
  metadata?: {
    runStatus: string;
    conclusion: string;
    headSha: string;
    headBranch: string;
    runNumber: number;
    attemptNumber?: number;
  };
}

export interface ProcessingResult {
  success: boolean;
  processedArtifacts: number;
  totalTests: number;
  totalFailures: number;
  totalErrors: number;
  testSuites: TestSuite[];
  errors: string[];
  warnings: string[];
  processingTimeMs: number;
}

export interface TestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  timestamp: string;
  testCases: TestCase[];
}

export interface TestCase {
  name: string;
  className: string;
  time: number;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  failure?: {
    message: string;
    type: string;
    stackTrace?: string;
  };
  error?: {
    message: string;
    type: string;
    stackTrace?: string;
  };
}

export interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  url: string;
  archive_download_url: string;
  expired: boolean;
  created_at: string;
  expires_at: string;
  updated_at: string;
}

// ============================================================================
// Processor Implementation
// ============================================================================

/**
 * Create runs ingestion processor
 */
export function createRunsIngestProcessor(
  prisma: PrismaClient,
  octokit?: Octokit
) {
  return async function processRunsIngest(
    job: Job<RunsIngestJobData>
  ): Promise<ProcessingResult> {
    const { data } = job;
    const startTime = Date.now();
    
    logger.info({
      jobId: job.id,
      workflowRunId: data.workflowRunId,
      repository: `${data.repository.owner}/${data.repository.repo}`,
      correlationId: data.correlationId,
      priority: data.priority,
      triggeredBy: data.triggeredBy
    }, 'Processing runs ingestion job');

    try {
      // Update job progress
      await job.updateProgress({
        phase: 'discovering',
        percentage: 10,
        message: 'Discovering artifacts'
      });

      // Get GitHub client (mock if not available)
      const github = octokit || createMockGitHubClient();
      
      // Fetch workflow run artifacts
      const artifacts = await fetchWorkflowArtifacts(github, data);
      
      if (artifacts.length === 0) {
        logger.info({ workflowRunId: data.workflowRunId }, 'No artifacts found for workflow run');
        return createEmptyResult(job.id!, startTime);
      }

      // Update progress
      await job.updateProgress({
        phase: 'downloading',
        percentage: 25,
        message: `Downloading ${artifacts.length} artifacts`
      });

      // Filter artifacts for test results
      const testArtifacts = filterTestArtifacts(artifacts);
      
      if (testArtifacts.length === 0) {
        logger.info({ workflowRunId: data.workflowRunId }, 'No test result artifacts found');
        return createEmptyResult(job.id!, startTime);
      }

      // Process each artifact
      const allTestSuites: TestSuite[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];
      let totalTests = 0;
      let totalFailures = 0;
      let totalErrors = 0;

      for (let i = 0; i < testArtifacts.length; i++) {
        const artifact = testArtifacts[i];
        if (!artifact) {continue;}
        
        try {
          // Update progress
          await job.updateProgress({
            phase: 'processing',
            percentage: 25 + (i / testArtifacts.length) * 50,
            message: `Processing artifact: ${artifact.name}`
          });

          const artifactStartTime = Date.now();
          
          // Download and process artifact
          const testSuites = await processArtifact(github, data, artifact);
          
          // Record metrics
          const processingTime = Date.now() - artifactStartTime;
          artifactProcessingTime.observe({ artifact_type: 'junit' }, processingTime / 1000);
          artifactSize.observe({ artifact_type: 'junit' }, artifact.size_in_bytes);
          artifactsProcessed.inc({ 
            repository: `${data.repository.owner}/${data.repository.repo}`,
            artifact_type: 'junit',
            status: 'success'
          });
          
          // Aggregate results
          allTestSuites.push(...testSuites);
          testSuites.forEach(suite => {
            totalTests += suite.tests;
            totalFailures += suite.failures;
            totalErrors += suite.errors;
          });
          
        } catch (error) {
          const errorMessage = `Failed to process artifact ${artifact.name}: ${error instanceof Error ? error.message : String(error)}`;
          logger.error({ artifactName: artifact.name, error: errorMessage }, 'Artifact processing failed');
          errors.push(errorMessage);
          
          artifactsProcessed.inc({ 
            repository: `${data.repository.owner}/${data.repository.repo}`,
            artifact_type: 'junit',
            status: 'error'
          });
        }
      }

      // Update progress
      await job.updateProgress({
        phase: 'storing',
        percentage: 80,
        message: 'Storing test results'
      });

      // Store results in database
      await storeTestResults(prisma, data, allTestSuites);
      
      // Record metrics
      testResultsParsed.inc({
        repository: `${data.repository.owner}/${data.repository.repo}`,
        test_framework: 'junit'
      }, totalTests);

      const processingTimeMs = Date.now() - startTime;
      
      // Final progress update
      await job.updateProgress({
        phase: 'complete',
        percentage: 100,
        message: 'Processing complete'
      });

      const result: ProcessingResult = {
        success: true,
        processedArtifacts: testArtifacts.length,
        totalTests,
        totalFailures,
        totalErrors,
        testSuites: allTestSuites,
        errors,
        warnings,
        processingTimeMs
      };

      // Record job completion metrics
      recordJobCompletion(QueueNames.RUNS_INGEST, 'completed', data.priority, processingTimeMs);
      
      logger.info({
        jobId: job.id,
        workflowRunId: data.workflowRunId,
        processedArtifacts: testArtifacts.length,
        totalTests,
        totalFailures,
        processingTimeMs
      }, 'Runs ingestion completed successfully');

      return result;

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Record failed job metrics
      recordJobCompletion(QueueNames.RUNS_INGEST, 'failed', data.priority, processingTimeMs, 'processing_error');
      
      logger.error({
        jobId: job.id,
        workflowRunId: data.workflowRunId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs
      }, 'Runs ingestion failed');

      throw error; // Re-throw to trigger retry logic
    }
  };
}

// ============================================================================
// GitHub API Functions
// ============================================================================

/**
 * Fetch workflow run artifacts from GitHub
 */
async function fetchWorkflowArtifacts(
  github: Octokit,
  data: RunsIngestJobData
): Promise<GitHubArtifact[]> {
  const startTime = Date.now();
  
  try {
    const response = await github.rest.actions.listWorkflowRunArtifacts({
      owner: data.repository.owner,
      repo: data.repository.repo,
      run_id: data.workflowRunId,
      per_page: 100
    });
    
    const duration = Date.now() - startTime;
    recordGitHubApiCall('listWorkflowRunArtifacts', 'GET', response.status, duration);
    
    return response.data.artifacts.map(artifact => ({
      ...artifact,
      created_at: artifact.created_at || new Date().toISOString(),
      expires_at: artifact.expires_at || new Date().toISOString(),
      updated_at: artifact.updated_at || new Date().toISOString()
    }));
    
  } catch (error) {
    const duration = Date.now() - startTime;
    recordGitHubApiCall('listWorkflowRunArtifacts', 'GET', 500, duration);
    
    if (error instanceof Error && 'status' in error && (error as Error & { status: number }).status === 404) {
      logger.warn({ workflowRunId: data.workflowRunId }, 'Workflow run not found');
      return [];
    }
    
    throw error;
  }
}

/**
 * Download artifact from GitHub
 */
async function downloadArtifact(
  github: Octokit,
  data: RunsIngestJobData,
  artifact: GitHubArtifact,
  destinationPath: string
): Promise<void> {
  const startTime = Date.now();
  
  try {
    const response = await github.rest.actions.downloadArtifact({
      owner: data.repository.owner,
      repo: data.repository.repo,
      artifact_id: artifact.id,
      archive_format: 'zip'
    });
    
    const duration = Date.now() - startTime;
    recordGitHubApiCall('downloadArtifact', 'GET', response.status, duration);
    
    // Write artifact data to file
    if (response.data instanceof ArrayBuffer) {
      const buffer = Buffer.from(response.data);
      await pipeline(
        Buffer.from(buffer),
        createWriteStream(destinationPath)
      );
    } else {
      throw new Error('Unexpected artifact data format');
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    recordGitHubApiCall('downloadArtifact', 'GET', 500, duration);
    throw error;
  }
}

// ============================================================================
// Artifact Processing Functions
// ============================================================================

/**
 * Filter artifacts to find test result files
 */
function filterTestArtifacts(artifacts: GitHubArtifact[]): GitHubArtifact[] {
  const filter = ARTIFACT_FILTERS.TEST_RESULTS;
  
  return artifacts.filter(artifact => {
    // Skip expired artifacts
    if (artifact.expired) {
      return false;
    }
    
    // Check size limits
    if (artifact.size_in_bytes > filter.maxSizeBytes) {
      return false;
    }
    
    // Check name patterns
    const nameMatches = filter.namePatterns.some(pattern => 
      artifact.name.toLowerCase().includes(pattern.toLowerCase())
    );
    
    return nameMatches;
  });
}

/**
 * Process a single artifact and extract test suites
 */
async function processArtifact(
  github: Octokit,
  data: RunsIngestJobData,
  artifact: GitHubArtifact
): Promise<TestSuite[]> {
  const tempDir = join(tmpdir(), `flakeguard-${Date.now()}-${artifact.id}`);
  const zipPath = join(tempDir, 'artifact.zip');
  
  try {
    // Create temporary directory
    mkdirSync(tempDir, { recursive: true });
    
    // Download artifact
    await downloadArtifact(github, data, artifact, zipPath);
    
    // Extract and parse test results
    const testSuites = await extractAndParseTestResults(zipPath, tempDir);
    
    return testSuites;
    
  } finally {
    // Cleanup temporary files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn({ tempDir, error: cleanupError }, 'Failed to cleanup temporary directory');
    }
  }
}

/**
 * Extract ZIP archive and parse JUnit XML files
 */
async function extractAndParseTestResults(zipPath: string, extractDir: string): Promise<TestSuite[]> {
  const testSuites: TestSuite[] = [];
  
  // Extract ZIP archive
  const zip = new StreamZip.async({ file: zipPath });
  
  try {
    await zip.extract(null, extractDir);
    const entries = await zip.entries();
    
    // Find XML files
    const xmlFiles = Object.values(entries).filter(entry => {
      return !entry.isDirectory && 
             entry.name.toLowerCase().endsWith('.xml') &&
             !entry.name.includes('__MACOSX'); // Skip macOS metadata
    });
    
    // Parse each XML file
    for (const entry of xmlFiles) {
      try {
        const extractedPath = join(extractDir, entry.name);
        const suites = await parseJUnitXML(extractedPath);
        testSuites.push(...suites);
      } catch (parseError) {
        logger.warn({
          fileName: entry.name,
          error: parseError instanceof Error ? parseError.message : String(parseError)
        }, 'Failed to parse XML file');
      }
    }
    
  } finally {
    await zip.close();
  }
  
  return testSuites;
}

/**
 * Parse JUnit XML file using SAX parser for memory efficiency
 */
async function parseJUnitXML(filePath: string): Promise<TestSuite[]> {
  return new Promise((resolve, reject) => {
    const testSuites: TestSuite[] = [];
    let currentSuite: Partial<TestSuite> | null = null;
    let currentTestCase: Partial<TestCase> | null = null;
    let textContent = '';
    
    const parser = sax.createStream(true, {
      trim: true,
      normalize: true
    });
    
    parser.on('error', (error) => {
      reject(new Error(`XML parsing error: ${error.message}`));
    });
    
    parser.on('opentag', (node) => {
      const { name, attributes } = node;
      
      switch (name.toLowerCase()) {
        case 'testsuite':
          currentSuite = {
            name: attributes.name as string || 'Unknown',
            tests: parseInt(attributes.tests as string) || 0,
            failures: parseInt(attributes.failures as string) || 0,
            errors: parseInt(attributes.errors as string) || 0,
            skipped: parseInt(attributes.skipped as string) || 0,
            time: parseFloat(attributes.time as string) || 0,
            timestamp: attributes.timestamp as string || new Date().toISOString(),
            testCases: []
          };
          break;
          
        case 'testcase':
          if (currentSuite) {
            currentTestCase = {
              name: attributes.name as string || 'Unknown',
              className: attributes.classname as string || attributes.class as string || 'Unknown',
              time: parseFloat(attributes.time as string) || 0,
              status: 'passed' // Default, will be updated if failure/error found
            };
          }
          break;
          
        case 'failure':
          if (currentTestCase) {
            currentTestCase.status = 'failed';
            currentTestCase.failure = {
              message: attributes.message as string || '',
              type: attributes.type as string || 'AssertionError'
            };
          }
          break;
          
        case 'error':
          if (currentTestCase) {
            currentTestCase.status = 'error';
            currentTestCase.error = {
              message: attributes.message as string || '',
              type: attributes.type as string || 'Error'
            };
          }
          break;
          
        case 'skipped':
          if (currentTestCase) {
            currentTestCase.status = 'skipped';
          }
          break;
      }
      
      textContent = '';
    });
    
    parser.on('text', (text) => {
      textContent += text;
    });
    
    parser.on('closetag', (tagName) => {
      switch (tagName.toLowerCase()) {
        case 'testsuite':
          if (currentSuite?.testCases) {
            testSuites.push(currentSuite as TestSuite);
            currentSuite = null;
          }
          break;
          
        case 'testcase':
          if (currentTestCase && currentSuite) {
            currentSuite.testCases!.push(currentTestCase as TestCase);
            currentTestCase = null;
          }
          break;
          
        case 'failure':
          if (currentTestCase?.failure && textContent.trim()) {
            currentTestCase.failure.stackTrace = textContent.trim();
          }
          break;
          
        case 'error':
          if (currentTestCase?.error && textContent.trim()) {
            currentTestCase.error.stackTrace = textContent.trim();
          }
          break;
      }
      
      textContent = '';
    });
    
    parser.on('end', () => {
      resolve(testSuites);
    });
    
    // Start parsing
    const stream = createReadStream(filePath);
    stream.pipe(parser);
  });
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Store test results in database
 */
async function storeTestResults(
  prisma: PrismaClient,
  data: RunsIngestJobData,
  testSuites: TestSuite[]
): Promise<void> {
  try {
    // Use database transaction for consistency
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create or update workflow run record
      await tx.fGWorkflowRun.upsert({
        where: {
          id: String(data.workflowRunId)
        },
        update: {
          status: data.metadata?.runStatus || 'completed',
          conclusion: data.metadata?.conclusion || 'success',
          updatedAt: new Date()
        },
        create: {
          id: String(data.workflowRunId),
          orgId: data.repository.owner,
          repoId: `${data.repository.owner}/${data.repository.repo}`,
          runId: String(data.workflowRunId),
          status: data.metadata?.runStatus || 'completed',
          conclusion: data.metadata?.conclusion || 'success',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      
      // Store test cases and occurrences
      for (const suite of testSuites) {
        // Store test cases
        for (const testCase of suite.testCases) {
          const fgTestCase = await tx.fGTestCase.upsert({
            where: {
              orgId_repoId_suite_className_name: {
                orgId: data.repository.owner,
                repoId: `${data.repository.owner}/${data.repository.repo}`,
                suite: suite.name,
                className: testCase.className || '',
                name: testCase.name
              }
            },
            update: {
              updatedAt: new Date()
            },
            create: {
              orgId: data.repository.owner,
              repoId: `${data.repository.owner}/${data.repository.repo}`,
              suite: suite.name,
              className: testCase.className,
              name: testCase.name,
              file: null,
              ownerTeam: null,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });
          
          // Create occurrence record
          await tx.fGOccurrence.create({
            data: {
              orgId: data.repository.owner,
              testId: fgTestCase.id,
              runId: String(data.workflowRunId),
              status: testCase.status,
              durationMs: Math.round(testCase.time * 1000), // Convert seconds to milliseconds
              failureMessage: testCase.failure?.message || testCase.error?.message,
              failureStackTrace: testCase.failure?.stackTrace || testCase.error?.stackTrace,
              createdAt: new Date()
            }
          });
        }
      }
    });
    
    logger.info({
      workflowRunId: data.workflowRunId,
      testSuites: testSuites.length,
      totalTests: testSuites.reduce((sum, suite) => sum + suite.tests, 0)
    }, 'Test results stored successfully');
    
  } catch (error) {
    logger.error({
      workflowRunId: data.workflowRunId,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to store test results');
    throw error;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create empty processing result
 */
function createEmptyResult(_jobId: string, startTime: number): ProcessingResult {
  return {
    success: true,
    processedArtifacts: 0,
    totalTests: 0,
    totalFailures: 0,
    totalErrors: 0,
    testSuites: [],
    errors: [],
    warnings: [],
    processingTimeMs: Date.now() - startTime
  };
}

/**
 * Create mock GitHub client for testing
 */
function createMockGitHubClient(): Octokit {
  const mockClient = {
    rest: {
      actions: {
        listWorkflowRunArtifacts: async () => ({
          data: { artifacts: [] },
          status: 200
        }),
        downloadArtifact: async () => ({
          data: new ArrayBuffer(0),
          status: 200
        })
      }
    }
  };
  return mockClient as unknown as Octokit;
}

// ============================================================================
// Export Processor Factory
// ============================================================================

/**
 * Factory function for runs ingestion processor
 */
export function runsIngestProcessor(
  prisma: PrismaClient,
  octokit?: Octokit
) {
  const processor = createRunsIngestProcessor(prisma, octokit);
  
  return async (job: Job<RunsIngestJobData>): Promise<ProcessingResult> => {
    return processor(job);
  };
}

export default runsIngestProcessor;