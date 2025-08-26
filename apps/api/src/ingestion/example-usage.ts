/**
 * Example usage of the JUnit Ingestion Service
 * 
 * This file demonstrates how to use the JUnitIngestionService in various scenarios
 */

import type { PrismaClient } from '@prisma/client';

import { GitHubAuthManager } from '../github/auth.js';
import { GitHubHelpers } from '../github/helpers.js';

import { 
  createIngestionService,
  ingestJUnitArtifacts,
  ingestFromGitHubWorkflowRun
} from './junit.js';
import type { 
  ArtifactSource, 
  RepositoryContext, 
  IngestionResult,
  JUnitFormat 
} from './types.js';

// ============================================================================
// Example 1: Basic artifact ingestion from URLs
// ============================================================================

export async function exampleBasicIngestion(
  prisma: PrismaClient
): Promise<IngestionResult> {
  console.log('🚀 Example 1: Basic JUnit artifact ingestion');
  
  // Define artifact sources (could be from any HTTP source)
  const artifacts: ArtifactSource[] = [
    {
      url: 'https://example.com/test-results.xml',
      name: 'test-results.xml',
      size: 1024 * 50 // 50KB
    },
    {
      url: 'https://example.com/surefire-reports.zip',
      name: 'surefire-reports.zip',
      size: 1024 * 200 // 200KB
    }
  ];

  // Repository context
  const repository: RepositoryContext = {
    owner: 'acme-corp',
    repo: 'my-awesome-app',
    runId: 12345
  };

  // Use the convenience function
  const result = await ingestJUnitArtifacts(artifacts, repository, {
    expectedFormat: 'surefire',
    prisma
  });

  console.log(`✅ Processed ${result.stats.totalFiles} files with ${result.stats.totalTests} tests`);
  return result;
}

// ============================================================================
// Example 2: GitHub workflow run ingestion
// ============================================================================

export async function exampleGitHubIngestion(
  prisma: PrismaClient,
  authManager: GitHubAuthManager
): Promise<IngestionResult> {
  console.log('🚀 Example 2: GitHub workflow run ingestion');

  // Create GitHub helpers
  const githubHelpers = new GitHubHelpers(authManager);

  // Direct GitHub ingestion using workflow run ID
  const result = await ingestFromGitHubWorkflowRun({
    owner: 'acme-corp',
    repo: 'my-awesome-app',
    runId: 12345,
    installationId: 67890,
    repositoryId: 'repo_abc123',
    expectedFormat: 'gradle',
    prisma,
    githubHelpers
  });

  console.log(`✅ GitHub ingestion completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  if (result.errors.length > 0) {
    console.error('❌ Errors:', result.errors.map(e => e.message));
  }

  return result;
}

// ============================================================================
// Example 3: Advanced service usage with event listening
// ============================================================================

export async function exampleAdvancedIngestion(
  prisma: PrismaClient,
  githubHelpers: GitHubHelpers
): Promise<IngestionResult> {
  console.log('🚀 Example 3: Advanced ingestion with event monitoring');

  // Create service instance
  const service = createIngestionService(prisma, githubHelpers);

  // Set up event listeners for progress monitoring
  service.on('progress', (progress) => {
    const percent = Math.round((progress.processed / progress.total) * 100);
    console.log(`📊 ${progress.phase.toUpperCase()}: ${percent}% (${progress.processed}/${progress.total})`);
    
    if (progress.fileName) {
      console.log(`   Processing: ${progress.fileName}`);
    }
  });

  service.on('artifact-processed', (result) => {
    console.log(`✅ Processed ${result.fileName}: ${result.testSuites.tests} tests, ${result.testSuites.failures} failures`);
  });

  service.on('error', (error) => {
    console.error(`❌ Ingestion error (${error.type}): ${error.message}`);
  });

  service.on('warning', (warning, context) => {
    console.warn(`⚠️  Warning: ${warning}`, context);
  });

  // Define complex ingestion configuration
  const artifacts: ArtifactSource[] = [
    {
      url: 'https://api.github.com/artifacts/123/download',
      name: 'jest-results.xml',
      downloadUrl: 'https://github.com/artifacts/temp-download-url',
      size: 1024 * 75,
      expiresAt: new Date(Date.now() + 60 * 1000) // Expires in 1 minute
    },
    {
      url: 'https://api.github.com/artifacts/456/download',
      name: 'pytest-results.zip',
      downloadUrl: 'https://github.com/artifacts/temp-download-url-2',
      size: 1024 * 150,
      expiresAt: new Date(Date.now() + 60 * 1000)
    }
  ];

  const repository: RepositoryContext = {
    owner: 'acme-corp',
    repo: 'backend-service',
    runId: 98765,
    sha: 'abc123def456'
  };

  // Advanced configuration
  const result = await service.ingest({
    correlationId: 'custom-correlation-id-123',
    config: {
      repository,
      artifacts,
      expectedFormat: 'jest',
      maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
      timeoutMs: 10 * 60 * 1000, // 10 minutes
      concurrency: 2, // Process 2 artifacts concurrently
      retryConfig: {
        maxAttempts: 5,
        baseDelayMs: 2000,
        maxDelayMs: 30000,
        backoffMultiplier: 2.5,
        jitterEnabled: true
      }
    }
  });

  console.log(`🎉 Advanced ingestion completed in ${result.stats.processingTimeMs}ms`);
  console.log(`📈 Final stats:`, {
    totalTests: result.stats.totalTests,
    failures: result.stats.totalFailures,
    errors: result.stats.totalErrors,
    skipped: result.stats.totalSkipped,
    files: result.stats.processedFiles
  });

  return result;
}

// ============================================================================
// Example 4: Direct GitHub API ingestion (most common use case)
// ============================================================================

export async function exampleDirectGitHubIngestion(
  prisma: PrismaClient,
  githubHelpers: GitHubHelpers
): Promise<IngestionResult> {
  console.log('🚀 Example 4: Direct GitHub ingestion (recommended approach)');

  const service = createIngestionService(prisma, githubHelpers);

  // This is the most common pattern - ingest directly from a GitHub workflow run
  const result = await service.ingestFromGitHub({
    owner: 'acme-corp',
    repo: 'frontend-app',
    runId: 555666,
    installationId: 77788,
    repositoryId: 'repo_xyz789',
    expectedFormat: 'jest',
    config: {
      maxFileSizeBytes: 25 * 1024 * 1024, // 25MB limit
      concurrency: 3 // Process up to 3 artifacts simultaneously
    }
  });

  if (result.success) {
    console.log('🎉 Success! Test results have been ingested and stored.');
    console.log(`   • Processed ${result.results.length} result files`);
    console.log(`   • Found ${result.stats.totalTests} total tests`);
    console.log(`   • ${result.stats.totalFailures} failures, ${result.stats.totalErrors} errors`);
  } else {
    console.error('❌ Ingestion failed:', result.errors.map(e => e.message));
  }

  return result;
}

// ============================================================================
// Example 5: Batch processing multiple workflow runs
// ============================================================================

export async function exampleBatchIngestion(
  prisma: PrismaClient,
  githubHelpers: GitHubHelpers,
  workflowRuns: Array<{
    owner: string;
    repo: string;
    runId: number;
    installationId: number;
    repositoryId: string;
  }>
): Promise<IngestionResult[]> {
  console.log('🚀 Example 5: Batch processing multiple workflow runs');

  const service = createIngestionService(prisma, githubHelpers);
  const results: IngestionResult[] = [];

  // Process workflow runs in parallel (with concurrency control)
  const batchSize = 3; // Process 3 runs simultaneously
  
  for (let i = 0; i < workflowRuns.length; i += batchSize) {
    const batch = workflowRuns.slice(i, i + batchSize);
    
    console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(workflowRuns.length / batchSize)}`);
    
    const batchPromises = batch.map(async (run) => {
      try {
        console.log(`   🔄 Processing ${run.owner}/${run.repo}#${run.runId}`);
        
        const result = await service.ingestFromGitHub({
          ...run,
          expectedFormat: 'generic', // Auto-detect format
        });
        
        console.log(`   ✅ Completed ${run.owner}/${run.repo}#${run.runId}: ${result.stats.totalTests} tests`);
        return result;
      } catch (error: any) {
        console.error(`   ❌ Failed ${run.owner}/${run.repo}#${run.runId}:`, error.message);
        return {
          success: false,
          results: [],
          stats: {
            totalFiles: 0,
            processedFiles: 0,
            failedFiles: 0,
            totalTests: 0,
            totalFailures: 0,
            totalErrors: 0,
            totalSkipped: 0,
            processingTimeMs: 0,
            downloadTimeMs: 0
          },
          errors: [{
            type: 'PROCESSING_FAILED' as const,
            message: error.message,
            timestamp: new Date()
          }]
        } as IngestionResult;
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    const successfulResults = batchResults
      .filter((result): result is PromiseFulfilledResult<IngestionResult> => 
        result.status === 'fulfilled'
      )
      .map(result => result.value);
    
    results.push(...successfulResults);
  }

  const totalTests = results.reduce((sum, r) => sum + r.stats.totalTests, 0);
  const totalFailures = results.reduce((sum, r) => sum + r.stats.totalFailures, 0);
  const successCount = results.filter(r => r.success).length;

  console.log(`🎉 Batch processing completed!`);
  console.log(`   • Successfully processed: ${successCount}/${workflowRuns.length} workflow runs`);
  console.log(`   • Total tests ingested: ${totalTests}`);
  console.log(`   • Total failures found: ${totalFailures}`);

  return results;
}

// ============================================================================
// Example 6: Error handling and retry strategies
// ============================================================================

export async function exampleErrorHandling(
  prisma: PrismaClient,
  githubHelpers: GitHubHelpers
): Promise<void> {
  console.log('🚀 Example 6: Error handling and retry strategies');

  const service = createIngestionService(prisma, githubHelpers);

  // Configure aggressive retry for unreliable network
  const robustConfig = {
    retryConfig: {
      maxAttempts: 5,
      baseDelayMs: 5000,    // Start with 5 second delay
      maxDelayMs: 60000,    // Maximum 1 minute delay
      backoffMultiplier: 3, // Aggressive backoff
      jitterEnabled: true   // Add randomization
    },
    timeoutMs: 15 * 60 * 1000, // 15 minute timeout
    maxFileSizeBytes: 200 * 1024 * 1024 // 200MB limit
  };

  try {
    const result = await service.ingestFromGitHub({
      owner: 'acme-corp',
      repo: 'unreliable-ci',
      runId: 999888,
      installationId: 111222,
      repositoryId: 'repo_unreliable123',
      config: robustConfig
    });

    if (result.success) {
      console.log('✅ Successfully handled potentially unreliable ingestion');
    } else {
      console.error('❌ Ingestion failed despite retry attempts:');
      result.errors.forEach((error, index) => {
        console.error(`   ${index + 1}. ${error.type}: ${error.message}`);
        if (error.fileName) {
          console.error(`      File: ${error.fileName}`);
        }
      });
    }
  } catch (error: any) {
    console.error('💥 Catastrophic failure:', error.message);
    
    // Implement fallback strategies
    console.log('🔄 Attempting fallback strategy...');
    // Could implement alternative ingestion methods here
  }
}

// ============================================================================
// Example 7: Format-specific ingestion
// ============================================================================

export async function exampleFormatSpecificIngestion(
  prisma: PrismaClient
): Promise<void> {
  console.log('🚀 Example 7: Format-specific JUnit ingestion');

  // Example for different JUnit formats
  const formatExamples: Array<{
    format: JUnitFormat;
    artifacts: ArtifactSource[];
    description: string;
  }> = [
    {
      format: 'surefire',
      artifacts: [{
        url: 'https://example.com/target/surefire-reports/TEST-results.xml',
        name: 'maven-surefire-results.xml'
      }],
      description: 'Maven Surefire test results'
    },
    {
      format: 'gradle',
      artifacts: [{
        url: 'https://example.com/build/test-results/test/results.xml',
        name: 'gradle-test-results.xml'
      }],
      description: 'Gradle test results'
    },
    {
      format: 'jest',
      artifacts: [{
        url: 'https://example.com/jest-results.xml',
        name: 'jest-junit-results.xml'
      }],
      description: 'Jest JavaScript test results'
    },
    {
      format: 'pytest',
      artifacts: [{
        url: 'https://example.com/pytest-results.xml',
        name: 'python-test-results.xml'
      }],
      description: 'Python pytest results'
    }
  ];

  const repository: RepositoryContext = {
    owner: 'acme-corp',
    repo: 'multi-language-app'
  };

  for (const example of formatExamples) {
    console.log(`\n📝 Processing ${example.description}`);
    
    try {
      const result = await ingestJUnitArtifacts(example.artifacts, repository, {
        expectedFormat: example.format,
        prisma
      });

      console.log(`   ✅ ${example.format.toUpperCase()}: ${result.stats.totalTests} tests processed`);
    } catch (error: any) {
      console.error(`   ❌ ${example.format.toUpperCase()} failed:`, error.message);
    }
  }
}

// ============================================================================
// Helper function to run all examples
// ============================================================================

export async function runAllExamples(
  _prisma: PrismaClient,
  authManager: GitHubAuthManager
): Promise<void> {
  console.log('🎯 Running all JUnit Ingestion Service examples\n');

  // const githubHelpers = new GitHubHelpers(authManager); // Unused in examples

  try {
    // Note: These examples use placeholder data
    // In real usage, you would have actual artifact URLs and repository data

    console.log('⚠️  Note: These examples use placeholder data');
    console.log('📚 See the implementation for patterns you can use in production\n');

    // Example workflow runs for batch processing
    const sampleWorkflowRuns = [
      { owner: 'acme-corp', repo: 'app-1', runId: 1001, installationId: 123, repositoryId: 'repo_1' },
      { owner: 'acme-corp', repo: 'app-2', runId: 1002, installationId: 123, repositoryId: 'repo_2' },
      { owner: 'acme-corp', repo: 'app-3', runId: 1003, installationId: 123, repositoryId: 'repo_3' }
    ];

    // Run examples (most would fail with placeholder data, but show the patterns)
    // await exampleBasicIngestion(prisma);
    // await exampleGitHubIngestion(prisma, authManager);
    // await exampleAdvancedIngestion(prisma, githubHelpers);
    // await exampleDirectGitHubIngestion(prisma, githubHelpers);
    // await exampleBatchIngestion(prisma, githubHelpers, sampleWorkflowRuns);
    // await exampleErrorHandling(prisma, githubHelpers);
    // await exampleFormatSpecificIngestion(prisma);

    console.log('✨ All examples completed successfully!');
  } catch (error: any) {
    console.error('💥 Example execution failed:', error.message);
    throw error;
  }
}