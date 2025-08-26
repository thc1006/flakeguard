/**
 * Playwright Global Teardown
 * 
 * Cleans up Docker Compose test environment
 */

import { execSync } from 'child_process';
import path from 'path';

function globalTeardown(): void {
  // eslint-disable-next-line no-console
  console.log('🧹 Cleaning up E2E test environment...');

  const projectRoot = path.resolve(__dirname, '../../../../..');

  try {
    // Stop and remove all test containers
    // eslint-disable-next-line no-console
    console.log('🛑 Stopping Docker Compose services...');
    execSync('docker-compose -f docker-compose.test.yml down -v --remove-orphans', {
      cwd: projectRoot,
      stdio: 'inherit',
      timeout: 30000,
    });

    // Remove test networks
    try {
      execSync('docker network rm flakeguard-test-network', {
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch (error) {
      // Network might not exist or already be removed
    }

    // Clean up test volumes (optional - comment out to preserve data between runs)
    try {
      // eslint-disable-next-line no-console
      console.log('🗑️ Removing test volumes...');
      execSync('docker volume rm $(docker volume ls -q | grep flakeguard.*test)', {
        shell: '/bin/bash',
        stdio: 'pipe',
        timeout: 10000,
      });
    } catch (error) {
      // Volumes might not exist
    }

    // Clean up any dangling images from test builds
    try {
      // eslint-disable-next-line no-console
      console.log('🧽 Cleaning up dangling images...');
      execSync('docker image prune -f --filter label=stage=test', {
        stdio: 'pipe',
        timeout: 15000,
      });
    } catch (error) {
      // No dangling images or Docker not available
    }

    // eslint-disable-next-line no-console
    console.log('✨ E2E test environment cleanup complete!');

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Error during E2E test environment cleanup:', error);
    // Don't throw error to avoid failing the test suite
  }
}

export default globalTeardown;