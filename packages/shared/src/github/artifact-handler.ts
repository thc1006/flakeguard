/**
 * Artifact Handler implementation for GitHub API
 * Handles artifact downloads with resilience and streaming support
 */

import type { Logger } from 'pino';
import { GitHubApiError } from './types.js';

import type {
  ArtifactDownloadConfig,
  ArtifactDownloadOptions,
  ArtifactStreamOptions,
  ArtifactUrlInfo,
} from './types.js';

/**
 * Artifact download handler with streaming and retry capabilities
 */
export class ArtifactHandler {
  private readonly urlCache = new Map<string, ArtifactUrlInfo>();
  private readonly downloadMetrics = {
    totalDownloads: 0,
    successfulDownloads: 0,
    failedDownloads: 0,
    retriedDownloads: 0,
    totalBytesDownloaded: 0,
    avgDownloadTimeMs: 0,
  };

  constructor(
    private readonly config: ArtifactDownloadConfig,
    private readonly logger: Logger,
    private readonly octokitRequest: (options: any) => Promise<any>
  ) {}

  /**
   * Download artifact with retry and validation
   */
  async downloadArtifact(options: ArtifactDownloadOptions): Promise<Buffer> {
    if (!this.config.enabled) {
      throw new GitHubApiError(
        'CONFIGURATION_INVALID',
        'Artifact download is disabled',
        { retryable: false }
      );
    }

    const startTime = Date.now();
    this.downloadMetrics.totalDownloads++;

    try {
      const downloadUrl = await this.getArtifactDownloadUrl(options);
      const buffer = await this.downloadWithRetry(downloadUrl, options);
      
      this.validateDownload(buffer, options);
      
      const duration = Date.now() - startTime;
      this.downloadMetrics.successfulDownloads++;
      this.downloadMetrics.totalBytesDownloaded += buffer.length;
      this.updateAvgDownloadTime(duration);

      this.logger.info(
        {
          artifactId: options.artifactId,
          owner: options.owner,
          repo: options.repo,
          size: buffer.length,
          duration,
        },
        'Artifact downloaded successfully'
      );

      return buffer;
    } catch (error) {
      this.downloadMetrics.failedDownloads++;
      
      this.logger.error(
        {
          artifactId: options.artifactId,
          owner: options.owner,
          repo: options.repo,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        },
        'Artifact download failed'
      );

      throw error;
    }
  }

  /**
   * Stream artifact download with resilience
   */
  async* streamArtifact(options: ArtifactStreamOptions): AsyncIterable<Buffer> {
    if (!this.config.enabled) {
      throw new GitHubApiError(
        'CONFIGURATION_INVALID',
        'Artifact download is disabled',
        { retryable: false }
      );
    }

    const startTime = Date.now();
    this.downloadMetrics.totalDownloads++;
    let totalBytes = 0;

    try {
      const downloadUrl = await this.getArtifactDownloadUrl(options);
      const chunkSize = options.chunkSize || this.config.streamChunkSize;
      
      this.logger.debug(
        {
          artifactId: options.artifactId,
          chunkSize,
          downloadUrl: downloadUrl.substring(0, 50) + '...',
        },
        'Starting artifact stream download'
      );

      for await (const chunk of this.streamDownloadWithRetry(downloadUrl, options, chunkSize)) {
        totalBytes += chunk.length;
        
        // Check size limits
        if (totalBytes > this.config.maxSizeBytes) {
          throw new GitHubApiError(
            'ARTIFACT_TOO_LARGE',
            `Artifact exceeds maximum size of ${this.config.maxSizeBytes} bytes`,
            {
              retryable: false,
              context: {
                artifactId: options.artifactId,
                maxSize: this.config.maxSizeBytes,
                currentSize: totalBytes,
              },
            }
          );
        }

        yield chunk;
      }

      const duration = Date.now() - startTime;
      this.downloadMetrics.successfulDownloads++;
      this.downloadMetrics.totalBytesDownloaded += totalBytes;
      this.updateAvgDownloadTime(duration);

      this.logger.info(
        {
          artifactId: options.artifactId,
          totalBytes,
          duration,
        },
        'Artifact stream download completed'
      );
    } catch (error) {
      this.downloadMetrics.failedDownloads++;
      
      this.logger.error(
        {
          artifactId: options.artifactId,
          duration: Date.now() - startTime,
          totalBytes,
          error: error instanceof Error ? error.message : String(error),
        },
        'Artifact stream download failed'
      );

      throw error;
    }
  }

  /**
   * Get artifact download URL with caching and expiry handling
   */
  private async getArtifactDownloadUrl(options: ArtifactDownloadOptions): Promise<string> {
    const cacheKey = `${options.owner}/${options.repo}/${options.artifactId}`;
    const cached = this.urlCache.get(cacheKey);

    // Return cached URL if still valid
    if (cached && !cached.isExpired) {
      this.logger.debug(
        { artifactId: options.artifactId, expiresAt: cached.expiresAt },
        'Using cached artifact download URL'
      );
      return cached.url;
    }

    // Fetch new download URL
    try {
      const response = await this.octokitRequest({
        method: 'GET',
        url: `/repos/${options.owner}/${options.repo}/actions/artifacts/${options.artifactId}/zip`,
        headers: {
          Accept: 'application/vnd.github+json',
        },
        request: {
          redirect: 'manual', // Don't follow redirects automatically
        },
      });

      const downloadUrl = response.url;
      if (!downloadUrl) {
        throw new GitHubApiError(
          'ARTIFACT_EXPIRED',
          'Failed to get artifact download URL',
          { retryable: true }
        );
      }

      // Cache URL with expiry (GitHub artifact URLs expire after ~1 minute)
      const expiresAt = new Date(Date.now() + 50000); // 50 seconds to be safe
      const urlInfo: ArtifactUrlInfo = {
        url: downloadUrl,
        expiresAt,
        isExpired: false,
        timeToExpiryMs: 50000,
      };

      this.urlCache.set(cacheKey, urlInfo);
      
      this.logger.debug(
        {
          artifactId: options.artifactId,
          expiresAt,
        },
        'Fetched new artifact download URL'
      );

      return downloadUrl;
    } catch (error) {
      this.logger.error(
        {
          artifactId: options.artifactId,
          owner: options.owner,
          repo: options.repo,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to get artifact download URL'
      );

      throw new GitHubApiError(
        'ARTIFACT_EXPIRED',
        'Failed to get artifact download URL',
        {
          retryable: true,
          context: { artifactId: options.artifactId },
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      );
    }
  }

  /**
   * Download with retry logic
   */
  private async downloadWithRetry(
    downloadUrl: string,
    options: ArtifactDownloadOptions
  ): Promise<Buffer> {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await this.performDownload(downloadUrl, options);
      } catch (error) {
        lastError = error;

        if (attempt > maxRetries) {
          break;
        }

        const isRetryable = this.isRetryableError(error);
        if (!isRetryable) {
          throw error;
        }

        // If URL expired, refresh it
        if (this.isUrlExpiredError(error)) {
          try {
            downloadUrl = await this.getArtifactDownloadUrl(options);
          } catch (refreshError) {
            this.logger.error(
              { attempt, error: refreshError },
              'Failed to refresh artifact URL'
            );
            throw refreshError;
          }
        }

        const delayMs = this.calculateRetryDelay(attempt);
        
        this.downloadMetrics.retriedDownloads++;
        
        this.logger.warn(
          {
            artifactId: options.artifactId,
            attempt,
            maxRetries,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          },
          'Artifact download failed, retrying'
        );

        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Stream download with retry logic
   */
  private async* streamDownloadWithRetry(
    downloadUrl: string,
    options: ArtifactStreamOptions,
    chunkSize: number
  ): AsyncIterable<Buffer> {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    let attempt = 1;
    let bytesReceived = 0;

    while (attempt <= maxRetries + 1) {
      try {
        const stream = await this.createDownloadStream(downloadUrl, options, bytesReceived);
        
        for await (const chunk of this.readStreamInChunks(stream, chunkSize)) {
          bytesReceived += chunk.length;
          yield chunk;
        }

        // If we get here, download completed successfully
        return;
      } catch (error) {
        if (attempt > maxRetries) {
          throw error;
        }

        const isRetryable = this.isRetryableError(error);
        if (!isRetryable) {
          throw error;
        }

        // If URL expired, refresh it
        if (this.isUrlExpiredError(error)) {
          try {
            downloadUrl = await this.getArtifactDownloadUrl(options);
          } catch (refreshError) {
            throw refreshError;
          }
        }

        const delayMs = this.calculateRetryDelay(attempt);
        
        this.logger.warn(
          {
            artifactId: options.artifactId,
            attempt,
            maxRetries,
            delayMs,
            bytesReceived,
            error: error instanceof Error ? error.message : String(error),
          },
          'Artifact stream download failed, retrying'
        );

        await this.delay(delayMs);
        attempt++;
      }
    }
  }

  /**
   * Perform actual download
   */
  private async performDownload(
    downloadUrl: string,
    options: ArtifactDownloadOptions
  ): Promise<Buffer> {
    const timeout = options.timeout || this.config.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(downloadUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'FlakeGuard-ArtifactHandler/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      
      if (buffer.length === 0) {
        throw new GitHubApiError(
          'ARTIFACT_EXPIRED',
          'Downloaded artifact is empty',
          { retryable: true }
        );
      }

      return buffer;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (controller.signal.aborted) {
        throw new GitHubApiError(
          'REQUEST_TIMEOUT',
          `Artifact download timed out after ${timeout}ms`,
          { retryable: true }
        );
      }

      throw error;
    }
  }

  /**
   * Create download stream with resume capability
   */
  private async createDownloadStream(
    downloadUrl: string,
    options: ArtifactStreamOptions,
    startByte: number = 0
  ): Promise<ReadableStream<Uint8Array>> {
    const timeout = options.timeout || this.config.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'FlakeGuard-ArtifactHandler/1.0',
      };

      // Add range header for resume capability
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }

      const response = await fetch(downloadUrl, {
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      return response.body;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (controller.signal.aborted) {
        throw new GitHubApiError(
          'REQUEST_TIMEOUT',
          `Artifact stream setup timed out after ${timeout}ms`,
          { retryable: true }
        );
      }

      throw error;
    }
  }

  /**
   * Read stream in chunks
   */
  private async* readStreamInChunks(
    stream: ReadableStream<Uint8Array>,
    chunkSize: number
  ): AsyncIterable<Buffer> {
    const reader = stream.getReader();
    let buffer = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Yield remaining buffer if any
          if (buffer.length > 0) {
            yield Buffer.from(buffer);
          }
          break;
        }

        // Combine new data with existing buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // Yield full chunks
        while (buffer.length >= chunkSize) {
          yield Buffer.from(buffer.slice(0, chunkSize));
          buffer = buffer.slice(chunkSize);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Validate downloaded artifact
   */
  private validateDownload(buffer: Buffer, options: ArtifactDownloadOptions): void {
    // Check size limits
    if (buffer.length > this.config.maxSizeBytes) {
      throw new GitHubApiError(
        'ARTIFACT_TOO_LARGE',
        `Artifact size ${buffer.length} exceeds maximum ${this.config.maxSizeBytes}`,
        {
          retryable: false,
          context: {
            artifactId: options.artifactId,
            actualSize: buffer.length,
            maxSize: this.config.maxSizeBytes,
          },
        }
      );
    }

    // Check for empty artifacts
    if (buffer.length === 0) {
      throw new GitHubApiError(
        'ARTIFACT_EXPIRED',
        'Downloaded artifact is empty',
        { retryable: true }
      );
    }

    // Validate ZIP file header (artifacts are always ZIP files)
    if (!this.isValidZipFile(buffer)) {
      throw new GitHubApiError(
        'ARTIFACT_EXPIRED',
        'Downloaded artifact is not a valid ZIP file',
        { retryable: true }
      );
    }
  }

  /**
   * Check if buffer is a valid ZIP file
   */
  private isValidZipFile(buffer: Buffer): boolean {
    // Check for ZIP file magic number (PK)
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof GitHubApiError) {
      return error.retryable;
    }

    // Network errors are generally retryable
    if (error.code === 'ECONNRESET' || 
        error.code === 'ENOTFOUND' || 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT') {
      return true;
    }

    // HTTP errors
    if (error.message?.includes('HTTP')) {
      const statusMatch = error.message.match(/HTTP (\d+)/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        return status >= 500 || status === 429; // Server errors or rate limiting
      }
    }

    return false;
  }

  /**
   * Check if error is due to expired URL
   */
  private isUrlExpiredError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return message.includes('expired') || 
           message.includes('not found') || 
           message.includes('404');
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const backoffMultiplier = 2;
    const jitterFactor = 0.1;

    const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    
    // Add jitter
    const jitter = cappedDelay * jitterFactor * (Math.random() - 0.5);
    const finalDelay = Math.max(0, cappedDelay + jitter);

    return Math.floor(finalDelay);
  }

  /**
   * Update average download time metric
   */
  private updateAvgDownloadTime(duration: number): void {
    const totalSamples = this.downloadMetrics.successfulDownloads;
    const currentAvg = this.downloadMetrics.avgDownloadTimeMs;
    
    // Exponential moving average
    this.downloadMetrics.avgDownloadTimeMs = totalSamples === 1 
      ? duration 
      : (currentAvg * 0.9) + (duration * 0.1);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get download metrics
   */
  getMetrics(): typeof this.downloadMetrics {
    return { ...this.downloadMetrics };
  }

  /**
   * Clear URL cache
   */
  clearCache(): void {
    this.urlCache.clear();
    this.logger.debug('Artifact URL cache cleared');
  }

  /**
   * Cleanup expired URLs from cache
   */
  cleanupExpiredUrls(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, urlInfo] of this.urlCache) {
      if (urlInfo.expiresAt.getTime() <= now) {
        this.urlCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleanedUrls: cleaned }, 'Cleaned up expired artifact URLs');
    }
  }
}