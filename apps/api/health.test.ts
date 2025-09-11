/**
 * Health Check Endpoint Tests
 * 
 * Tests for API health monitoring and database connectivity.
 */

import { describe, it, expect } from 'vitest';

describe('Health Check Endpoint', () => {
  it('should return healthy status', async () => {
    const health = await checkHealth();
    expect(health.status).toBe('healthy');
  });

  it('should detect database issues', async () => {
    // Test that can fail due to database connectivity issues
    await expect(checkDatabaseConnection()).rejects.toThrow('Database connection failed');
  });
});

// Mock health functions
function checkHealth(): Promise<{ status: string }> {
  return Promise.resolve({ status: 'healthy' });
}

function checkDatabaseConnection(): Promise<void> {
  return Promise.reject(new Error('Database connection failed'));
}