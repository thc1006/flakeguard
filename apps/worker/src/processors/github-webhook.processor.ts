/**
 * GitHub Webhook Event Processor - P3 Implementation
 * 
 * Processes GitHub webhook events enqueued by the P1 webhook route.
 * This processor implements the P3 requirement for artifact ingestion:
 * - Processes workflow_run completed events
 * - Downloads and parses JUnit XML artifacts
 * - Upserts TestCase/Occurrence records
 * - Integrates with existing JUnit parser from ingestion package
 */

import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { GitHubEventJob } from '../../api/src/routes/github-webhook.js';
import { createOctokitHelpers } from '@flakeguard/shared';
import { parseJUnitXMLFile } from '../../api/src/ingestion/parsers/junit-parser.js';
import StreamZip from 'node-stream-zip';
import { createReadStream, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, extname } from 'path';
import { logger } from '../utils/logger.js';

// Types from ingestion parser
interface TestCase {
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

interface TestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  timestamp: string;
  testCases: TestCase[];
}

interface ProcessingResult {
  success: boolean;
  processedArtifacts: number;
  totalTests: number;
  failedTests: number;
  testSuites: TestSuite[];
  errors: string[];
}

/**
 * GitHub Webhook Event Processor
 */
export function createGitHubWebhookProcessor(prisma: PrismaClient) {
  const octokitHelpers = createOctokitHelpers();

  return async function processGitHubWebhook(
    job: Job<GitHubEventJob>
  ): Promise<ProcessingResult> {
    const { data } = job;
    const startTime = Date.now();

    logger.info({
      jobId: job.id,
      eventType: data.eventType,
      deliveryId: data.deliveryId,
      repositoryFullName: data.repositoryFullName,
      installationId: data.installationId,
    }, 'Processing GitHub webhook event');

    try {
      // Only process workflow_run completed events for now
      if (data.eventType !== 'workflow_run' || data.action !== 'completed') {
        logger.info({
          eventType: data.eventType,
          action: data.action,
        }, 'Skipping event - not a completed workflow run');

        return {
          success: true,
          processedArtifacts: 0,
          totalTests: 0,
          failedTests: 0,
          testSuites: [],
          errors: [],
        };
      }

      // Extract repository information
      const { repositoryId, repositoryFullName, installationId } = data;
      if (!repositoryFullName || !installationId) {
        throw new Error('Missing required repository or installation information');
      }

      const [owner, repo] = repositoryFullName.split('/');
      const workflowRunId = data.payload.workflow_run?.id;

      if (!workflowRunId) {
        throw new Error('Missing workflow run ID in payload');
      }

      // Update job progress
      await job.updateProgress({
        phase: 'discovering',
        percentage: 10,
        message: 'Discovering artifacts',
      });

      // List artifacts for the workflow run
      const artifacts = await octokitHelpers.listRunArtifacts({
        owner,
        repo,
        runId: workflowRunId,
        installationId,
      });

      // Filter for test result artifacts
      const testArtifacts = artifacts.filter(artifact => {
        // Skip expired artifacts
        if (artifact.expired) return false;
        
        // Look for common test result patterns
        const name = artifact.name.toLowerCase();
        return name.includes('test') || 
               name.includes('junit') || 
               name.includes('results') ||
               name.includes('report');
      });

      if (testArtifacts.length === 0) {
        logger.info({
          workflowRunId,
          totalArtifacts: artifacts.length,
        }, 'No test result artifacts found');

        return {
          success: true,
          processedArtifacts: 0,
          totalTests: 0,
          failedTests: 0,
          testSuites: [],
          errors: [],
        };
      }

      // Update job progress
      await job.updateProgress({
        phase: 'downloading',
        percentage: 25,
        message: `Downloading ${testArtifacts.length} test artifacts`,
      });

      // Process each artifact
      const allTestSuites: TestSuite[] = [];
      const errors: string[] = [];

      for (let i = 0; i < testArtifacts.length; i++) {
        const artifact = testArtifacts[i];

        try {
          // Update progress
          await job.updateProgress({
            phase: 'processing',
            percentage: 25 + (i / testArtifacts.length) * 50,
            message: `Processing artifact: ${artifact.name}`,
          });

          // Download and process artifact
          const testSuites = await processTestArtifact(
            octokitHelpers,
            { owner, repo, installationId },
            artifact
          );

          allTestSuites.push(...testSuites);

          logger.info({
            artifactId: artifact.id,
            artifactName: artifact.name,
            testSuites: testSuites.length,
            totalTests: testSuites.reduce((sum, suite) => sum + suite.tests, 0),
          }, 'Artifact processed successfully');

        } catch (error) {
          const errorMessage = `Failed to process artifact ${artifact.name}: ${
            error instanceof Error ? error.message : String(error)
          }`;
          logger.error({ artifactId: artifact.id, error }, errorMessage);
          errors.push(errorMessage);
        }
      }

      // Update job progress
      await job.updateProgress({
        phase: 'storing',
        percentage: 80,
        message: 'Storing test results in database',
      });

      // P3 Requirement: Upsert TestCase/Occurrence records
      await storeTestResults(prisma, {
        workflowRunId,
        repositoryId,
        repositoryFullName,
        headSha: data.payload.workflow_run?.head_sha || '',
        headBranch: data.payload.workflow_run?.head_branch || 'main',
        runNumber: data.payload.workflow_run?.run_number || 0,
        conclusion: data.payload.workflow_run?.conclusion || 'unknown',
        runUrl: data.payload.workflow_run?.html_url || '',
      }, allTestSuites);

      const totalTests = allTestSuites.reduce((sum, suite) => sum + suite.tests, 0);
      const failedTests = allTestSuites.reduce((sum, suite) => sum + suite.failures + suite.errors, 0);

      // Final progress update
      await job.updateProgress({
        phase: 'complete',
        percentage: 100,
        message: 'Processing complete',
      });

      const result: ProcessingResult = {
        success: true,
        processedArtifacts: testArtifacts.length,
        totalTests,
        failedTests,
        testSuites: allTestSuites,
        errors,
      };

      logger.info({
        jobId: job.id,
        workflowRunId,
        processedArtifacts: testArtifacts.length,
        totalTests,
        failedTests,
        processingTimeMs: Date.now() - startTime,
      }, 'GitHub webhook event processed successfully');

      return result;

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      logger.error({
        jobId: job.id,
        eventType: data.eventType,
        deliveryId: data.deliveryId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs,
      }, 'GitHub webhook event processing failed');

      throw error;
    }
  };
}

/**
 * Process a single test artifact
 */
async function processTestArtifact(
  octokitHelpers: ReturnType<typeof createOctokitHelpers>,
  repo: { owner: string; repo: string; installationId: number },
  artifact: any
): Promise<TestSuite[]> {
  const tempDir = join(tmpdir(), `flakeguard-${Date.now()}-${artifact.id}`);
  
  try {
    // Create temporary directory
    mkdirSync(tempDir, { recursive: true });

    // Download artifact
    const artifactPath = await octokitHelpers.downloadArtifactZip({
      owner: repo.owner,
      repo: repo.repo,
      artifactId: artifact.id,
      installationId: repo.installationId,
    });

    // Extract and parse JUnit files from the zip
    const testSuites = await extractAndParseJUnitFiles(artifactPath, tempDir);
    
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
 * Extract ZIP and parse JUnit XML files
 */
async function extractAndParseJUnitFiles(
  zipPath: string,
  extractDir: string
): Promise<TestSuite[]> {
  const testSuites: TestSuite[] = [];
  
  // Extract ZIP file
  const zip = new StreamZip.async({ file: zipPath });

  try {
    await zip.extract(null, extractDir);
    const entries = await zip.entries();

    // Find XML files that might contain JUnit results
    const xmlFiles = Object.values(entries).filter(entry => {
      return !entry.isDirectory &&
             extname(entry.name).toLowerCase() === '.xml' &&
             !entry.name.includes('__MACOSX') && // Skip macOS metadata
             !entry.name.includes('.DS_Store'); // Skip macOS metadata
    });

    // Parse each XML file
    for (const entry of xmlFiles) {
      try {
        const extractedPath = join(extractDir, entry.name);
        
        // Use the existing JUnit parser from P3 requirements
        const parseResult = await parseJUnitXMLFile(extractedPath);
        
        // Convert to our TestSuite format
        const convertedSuites = parseResult.testSuites.suites?.map(suite => ({
          name: suite.name || 'Unknown',
          tests: suite.tests || 0,
          failures: suite.failures || 0,
          errors: suite.errors || 0,
          skipped: suite.skipped || 0,
          time: suite.time || 0,
          timestamp: suite.timestamp || new Date().toISOString(),
          testCases: suite.testCases?.map(testCase => ({
            name: testCase.name || 'Unknown',
            className: testCase.className || 'Unknown',
            time: testCase.time || 0,
            status: testCase.status || 'passed',
            failure: testCase.failure,
            error: testCase.error,
          })) || [],
        })) || [];

        testSuites.push(...convertedSuites);

      } catch (parseError) {
        logger.warn({
          fileName: entry.name,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        }, 'Failed to parse XML file as JUnit');
      }
    }

  } finally {
    await zip.close();
  }

  return testSuites;
}

/**
 * P3 Requirement: Store test results and upsert TestCase/Occurrence records
 */
async function storeTestResults(
  prisma: PrismaClient,
  runInfo: {
    workflowRunId: number;
    repositoryId?: number;
    repositoryFullName: string;
    headSha: string;
    headBranch: string;
    runNumber: number;
    conclusion: string;
    runUrl: string;
  },
  testSuites: TestSuite[]
): Promise<void> {
  const { workflowRunId, repositoryFullName, headSha, headBranch, runNumber, conclusion } = runInfo;

  await prisma.$transaction(async (tx) => {
    // Create or update WorkflowRun record
    const workflowRun = await tx.workflowRun.upsert({
      where: { id: workflowRunId },
      update: {
        conclusion,
        updatedAt: new Date(),
      },
      create: {
        id: workflowRunId,
        repoId: runInfo.repositoryId || 0, // Will need to be properly mapped
        runId: workflowRunId,
        status: 'completed',
        conclusion,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Process each test suite
    for (const suite of testSuites) {
      // Process each test case in the suite
      for (const testCase of suite.testCases) {
        // P3 Requirement: Extract suite, className, name, status, time, failure message/stack
        const testIdentifier = {
          suite: suite.name,
          className: testCase.className,
          name: testCase.name,
        };

        // Upsert TestCase record
        const testCaseRecord = await tx.testCase.upsert({
          where: {
            repoId_suite_className_name: {
              repoId: workflowRun.repoId,
              suite: testIdentifier.suite,
              className: testIdentifier.className,
              name: testIdentifier.name,
            },
          },
          update: {
            // Update any metadata as needed
            ownerTeam: null, // Could be extracted from file path
          },
          create: {
            repoId: workflowRun.repoId,
            suite: testIdentifier.suite,
            className: testIdentifier.className,
            name: testIdentifier.name,
            file: null, // Could be extracted from className
            ownerTeam: null,
          },
        });

        // Create Occurrence record
        await tx.occurrence.create({
          data: {
            testId: testCaseRecord.id,
            runId: workflowRun.id,
            status: testCase.status,
            durationMs: Math.round((testCase.time || 0) * 1000),
            failureMsgSignature: testCase.failure?.message || testCase.error?.message || null,
            failureStackDigest: testCase.failure?.stackTrace || testCase.error?.stackTrace || null,
            attempt: 1, // Could be derived from retry information
            createdAt: new Date(),
          },
        });
      }
    }

    logger.info({
      workflowRunId,
      testSuites: testSuites.length,
      totalTests: testSuites.reduce((sum, suite) => sum + suite.tests, 0),
    }, 'Test results stored in database');
  });
}

/**
 * Export factory function
 */
export function githubWebhookProcessor(prisma: PrismaClient) {
  const processor = createGitHubWebhookProcessor(prisma);
  return async (job: Job<GitHubEventJob>) => processor(job);
}

export default githubWebhookProcessor;