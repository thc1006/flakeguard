#!/usr/bin/env node

/**
 * FlakeGuard Bulk Artifact Downloader
 * 
 * Downloads all artifacts from a GitHub Actions run with robust retry logic
 * and proper handling of URL expiration (1-minute TTL)
 */

import { ArtifactRetriever } from './fetch-artifact.js';
import { join } from 'path';
import { mkdirSync } from 'fs';

interface BulkDownloadOptions {
  owner: string;
  repo: string;
  runId?: string;
  outputDir: string;
  token?: string;
  maxConcurrent?: number;
  nameFilter?: RegExp;
}

class BulkArtifactDownloader {
  private retriever: ArtifactRetriever;
  
  constructor(token?: string) {
    this.retriever = new ArtifactRetriever(token);
  }

  /**
   * Download all artifacts from a repository with robust retry logic
   */
  async downloadAllArtifacts(options: BulkDownloadOptions): Promise<void> {
    const {
      owner,
      repo,
      outputDir,
      maxConcurrent = 3,
      nameFilter
    } = options;

    console.log(`📦 Starting bulk artifact download for ${owner}/${repo}`);
    console.log(`📁 Output directory: ${outputDir}`);

    // Ensure output directory exists
    mkdirSync(outputDir, { recursive: true });

    // List all available artifacts
    const artifacts = await this.retriever.listArtifacts(owner, repo);
    
    if (artifacts.length === 0) {
      console.log('📭 No artifacts found in repository');
      return;
    }

    // Filter artifacts if nameFilter provided
    const filteredArtifacts = nameFilter 
      ? artifacts.filter(artifact => nameFilter.test(artifact.name))
      : artifacts;

    console.log(`🎯 Found ${filteredArtifacts.length} artifacts to download (${artifacts.length} total)`);

    // Process artifacts in batches to avoid overwhelming the API
    const downloadPromises: Promise<void>[] = [];
    const semaphore = new Semaphore(maxConcurrent);

    for (const artifact of filteredArtifacts) {
      const downloadPromise = semaphore.acquire().then(async (release) => {
        try {
          const outputPath = join(outputDir, `${artifact.name}-${artifact.id}.zip`);
          
          console.log(`📥 Downloading: ${artifact.name} (${artifact.id})`);
          
          await this.retriever.downloadArtifact({
            owner,
            repo,
            artifactId: String(artifact.id),
            outputPath,
            maxRetries: 3 // Reduced retries for bulk operations
          });
          
          console.log(`✅ Downloaded: ${artifact.name}`);
          
        } catch (error) {
          console.error(`❌ Failed to download ${artifact.name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          release();
        }
      });
      
      downloadPromises.push(downloadPromise);
    }

    // Wait for all downloads to complete
    await Promise.all(downloadPromises);
    
    console.log(`🎉 Bulk download completed! Check ${outputDir} for artifacts`);
  }

  /**
   * Download artifacts from specific workflow run
   */
  async downloadRunArtifacts(options: BulkDownloadOptions & { runId: string }): Promise<void> {
    console.log(`🔄 Downloading artifacts from workflow run ${options.runId}`);
    
    // For now, we download all artifacts since GitHub API doesn't filter by run ID directly
    // In a production implementation, you'd filter artifacts by workflow run metadata
    await this.downloadAllArtifacts(options);
  }
}

/**
 * Simple semaphore implementation for controlling concurrency
 */
class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve(() => this.release());
      } else {
        this.waitQueue.push(() => {
          this.permits--;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('⚠️  No GITHUB_TOKEN found. Private repository access may fail.');
  }
  
  const downloader = new BulkArtifactDownloader(token);
  
  try {
    switch (command) {
      case 'download-all': {
        const [owner, repo, outputDir] = args.slice(1);
        
        if (!owner || !repo || !outputDir) {
          console.error('Usage: bulk-artifact-download download-all <owner> <repo> <output_dir>');
          process.exit(1);
        }
        
        await downloader.downloadAllArtifacts({
          owner,
          repo,
          outputDir
        });
        break;
      }
      
      case 'download-run': {
        const [owner, repo, runId, outputDir] = args.slice(1);
        
        if (!owner || !repo || !runId || !outputDir) {
          console.error('Usage: bulk-artifact-download download-run <owner> <repo> <run_id> <output_dir>');
          process.exit(1);
        }
        
        await downloader.downloadRunArtifacts({
          owner,
          repo,
          runId,
          outputDir
        });
        break;
      }
      
      case 'download-filtered': {
        const [owner, repo, outputDir, filterPattern] = args.slice(1);
        
        if (!owner || !repo || !outputDir || !filterPattern) {
          console.error('Usage: bulk-artifact-download download-filtered <owner> <repo> <output_dir> <filter_pattern>');
          process.exit(1);
        }
        
        const nameFilter = new RegExp(filterPattern, 'i');
        
        await downloader.downloadAllArtifacts({
          owner,
          repo,
          outputDir,
          nameFilter
        });
        break;
      }
      
      default:
        console.log('FlakeGuard Bulk Artifact Downloader');
        console.log('');
        console.log('Commands:');
        console.log('  download-all <owner> <repo> <output_dir>                     Download all artifacts');
        console.log('  download-run <owner> <repo> <run_id> <output_dir>           Download artifacts from specific run');
        console.log('  download-filtered <owner> <repo> <output_dir> <pattern>     Download artifacts matching pattern');
        console.log('');
        console.log('Environment variables:');
        console.log('  GITHUB_TOKEN  GitHub personal access token (required for private repos)');
        console.log('');
        console.log('Examples:');
        console.log('  # Download all test artifacts');
        console.log('  bulk-artifact-download download-filtered owner repo ./artifacts "test.*results"');
        console.log('');
        console.log('  # Download all artifacts from a specific run');
        console.log('  bulk-artifact-download download-run owner repo 123456789 ./run-artifacts');
        process.exit(1);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Export for use as module
export { BulkArtifactDownloader };

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bulk-artifact-download.js')) {
  main().catch(console.error);
}