#!/usr/bin/env node

/**
 * FlakeGuard Artifact Retriever
 * 
 * Robustly downloads GitHub Actions artifacts with proper handling of:
 * - Expiring redirect URLs (1-minute TTL)
 * - Retry logic with exponential backoff
 * - Clear logging for debugging
 * - PAT authentication for private repos
 */

import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';

interface ArtifactDownloadOptions {
  owner: string;
  repo: string;
  artifactId: string;
  outputPath: string;
  token?: string;
  archiveFormat?: 'zip';
  maxRetries?: number;
  retryDelayMs?: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
}

class ArtifactRetriever {
  private readonly baseUrl = 'https://api.github.com';
  private readonly defaultRetryConfig: RetryConfig = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    exponentialBase: 2
  };

  constructor(private token?: string) {}

  /**
   * Download artifact with robust retry logic
   */
  async downloadArtifact(options: ArtifactDownloadOptions): Promise<void> {
    const {
      owner,
      repo,
      artifactId,
      outputPath,
      archiveFormat = 'zip',
      maxRetries = this.defaultRetryConfig.maxRetries,
      retryDelayMs = this.defaultRetryConfig.baseDelayMs
    } = options;

    const retryConfig: RetryConfig = {
      maxRetries,
      baseDelayMs: retryDelayMs,
      maxDelayMs: this.defaultRetryConfig.maxDelayMs,
      exponentialBase: this.defaultRetryConfig.exponentialBase
    };

    console.log(`📦 Starting artifact download: ${artifactId}`);
    console.log(`   Repository: ${owner}/${repo}`);
    console.log(`   Output: ${outputPath}`);
    console.log(`   Format: ${archiveFormat}`);

    // Ensure output directory exists
    mkdirSync(dirname(outputPath), { recursive: true });

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        console.log(`\n🔄 Attempt ${attempt}/${retryConfig.maxRetries}`);
        
        // Step 1: Get redirect URL (always fresh due to 1-minute expiration)
        const downloadUrl = await this.getArtifactDownloadUrl(owner, repo, artifactId, archiveFormat);
        
        // Step 2: Download from redirect URL
        await this.downloadFromUrl(downloadUrl, outputPath);
        
        console.log(`✅ Artifact downloaded successfully: ${outputPath}`);
        return;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (this.isRetryableError(lastError)) {
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          
          console.error(`❌ Attempt ${attempt} failed: ${lastError.message}`);
          
          if (attempt < retryConfig.maxRetries) {
            console.log(`⏱️  Waiting ${delay}ms before retry...`);
            await this.sleep(delay);
          }
        } else {
          console.error(`💀 Non-retryable error: ${lastError.message}`);
          throw lastError;
        }
      }
    }
    
    throw new Error(`Failed to download artifact after ${retryConfig.maxRetries} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Get fresh download URL from GitHub API (handles 1-minute expiration)
   */
  private async getArtifactDownloadUrl(
    owner: string,
    repo: string,
    artifactId: string,
    archiveFormat: string
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/actions/artifacts/${artifactId}/${archiveFormat}`;
    
    console.log(`🔗 Fetching download URL: ${url}`);
    
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'FlakeGuard-ArtifactRetriever/1.0.0'
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual' // We want to capture the Location header
    });
    
    if (response.status === 302) {
      const location = response.headers.get('Location');
      if (!location) {
        throw new Error('Expected Location header not found in redirect response');
      }
      
      console.log(`📍 Got redirect URL (expires in ~1 minute)`);
      return location;
    }
    
    if (response.status === 401) {
      throw new Error('Authentication failed. Ensure GITHUB_TOKEN has repo scope for private repositories.');
    }
    
    if (response.status === 403) {
      throw new Error('Access denied. Check repository permissions and rate limits.');
    }
    
    if (response.status === 404) {
      throw new Error(`Artifact ${artifactId} not found. It may have been deleted or expired.`);
    }
    
    throw new Error(`Unexpected response status: ${response.status} ${response.statusText}`);
  }

  /**
   * Download file from URL with streaming
   */
  private async downloadFromUrl(url: string, outputPath: string): Promise<void> {
    console.log(`⬇️  Downloading from redirect URL...`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 403 && response.statusText.includes('Forbidden')) {
        throw new Error('Download URL expired (1-minute TTL exceeded). Will retry with fresh URL.');
      }
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    
    if (!response.body) {
      throw new Error('Response body is null');
    }
    
    // Stream the download to file
    const fileStream = createWriteStream(outputPath);
    
    try {
      // Stream download by reading chunks directly
      
      // Convert ReadableStream to Node stream for pipeline
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      
      // Write all chunks to file
      for (const chunk of chunks) {
        fileStream.write(chunk);
      }
      
      fileStream.end();
      
      // Wait for file to be written
      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', () => resolve());
        fileStream.on('error', reject);
      });
      
      console.log(`💾 Artifact saved successfully`);
      
    } catch (error) {
      fileStream.destroy();
      throw error;
    }
  }

  /**
   * Determine if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const retryableMessages = [
      'Download URL expired',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'fetch failed',
      'network error'
    ];
    
    return retryableMessages.some(msg => 
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    const delay = config.baseDelayMs * Math.pow(config.exponentialBase, attempt - 1);
    const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
    return Math.min(delay + jitter, config.maxDelayMs);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * List artifacts for a repository
   */
  async listArtifacts(owner: string, repo: string, options: {
    per_page?: number;
    page?: number;
  } = {}): Promise<any[]> {
    const { per_page = 30, page = 1 } = options;
    const url = `${this.baseUrl}/repos/${owner}/${repo}/actions/artifacts?per_page=${per_page}&page=${page}`;
    
    console.log(`📋 Listing artifacts: ${owner}/${repo}`);
    
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'FlakeGuard-ArtifactRetriever/1.0.0'
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to list artifacts: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.artifacts || [];
  }

  /**
   * Get artifact metadata
   */
  async getArtifactInfo(owner: string, repo: string, artifactId: string): Promise<any> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/actions/artifacts/${artifactId}`;
    
    console.log(`ℹ️  Getting artifact info: ${artifactId}`);
    
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'FlakeGuard-ArtifactRetriever/1.0.0'
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to get artifact info: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
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
  
  const retriever = new ArtifactRetriever(token);
  
  try {
    switch (command) {
      case 'download': {
        const [owner, repo, artifactId, outputPath] = args.slice(1);
        
        if (!owner || !repo || !artifactId || !outputPath) {
          console.error('Usage: fetch-artifact download <owner> <repo> <artifact_id> <output_path>');
          process.exit(1);
        }
        
        await retriever.downloadArtifact({
          owner,
          repo,
          artifactId,
          outputPath
        });
        break;
      }
      
      case 'list': {
        const [owner, repo] = args.slice(1);
        
        if (!owner || !repo) {
          console.error('Usage: fetch-artifact list <owner> <repo>');
          process.exit(1);
        }
        
        const artifacts = await retriever.listArtifacts(owner, repo);
        
        console.log(`\n📦 Found ${artifacts.length} artifacts:\n`);
        console.log('ID'.padEnd(12) + 'Name'.padEnd(30) + 'Size'.padEnd(10) + 'Created');
        console.log('─'.repeat(70));
        
        for (const artifact of artifacts) {
          const size = artifact.size_in_bytes ? `${Math.round(artifact.size_in_bytes / 1024)}KB` : 'Unknown';
          const created = new Date(artifact.created_at).toLocaleDateString();
          
          console.log(
            String(artifact.id).padEnd(12) +
            artifact.name.padEnd(30) +
            size.padEnd(10) +
            created
          );
        }
        break;
      }
      
      case 'info': {
        const [owner, repo, artifactId] = args.slice(1);
        
        if (!owner || !repo || !artifactId) {
          console.error('Usage: fetch-artifact info <owner> <repo> <artifact_id>');
          process.exit(1);
        }
        
        const info = await retriever.getArtifactInfo(owner, repo, artifactId);
        console.log('\n📋 Artifact Information:');
        console.log(JSON.stringify(info, null, 2));
        break;
      }
      
      default:
        console.log('FlakeGuard Artifact Retriever');
        console.log('');
        console.log('Commands:');
        console.log('  download <owner> <repo> <artifact_id> <output_path>  Download an artifact');
        console.log('  list <owner> <repo>                                  List available artifacts');
        console.log('  info <owner> <repo> <artifact_id>                   Get artifact metadata');
        console.log('');
        console.log('Environment variables:');
        console.log('  GITHUB_TOKEN  GitHub personal access token (required for private repos)');
        process.exit(1);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Export for use as module
export { ArtifactRetriever };

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fetch-artifact.js')) {
  main().catch(console.error);
}