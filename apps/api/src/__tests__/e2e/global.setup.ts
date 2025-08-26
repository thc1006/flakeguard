/**
 * Playwright Global Setup
 * 
 * Manages Docker Compose test environment lifecycle
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

// import { chromium, type FullConfig } from '@playwright/test';
import { type FullConfig } from '@playwright/test';

let dockerProcess: ChildProcess | null = null;

async function globalSetup(_config: FullConfig) {
  // eslint-disable-next-line no-console
  console.log('🚀 Starting E2E test environment...');

  const projectRoot = path.resolve(__dirname, '../../../../..');
  const dockerComposePath = path.join(projectRoot, 'docker-compose.test.yml');

  // Verify Docker Compose file exists
  if (!existsSync(dockerComposePath)) {
    throw new Error(`Docker Compose file not found: ${dockerComposePath}`);
  }

  try {
    // Clean up any existing test containers
    // eslint-disable-next-line no-console
    console.log('🧹 Cleaning up existing test containers...');
    try {
      execSync('docker-compose -f docker-compose.test.yml down -v', {
        cwd: projectRoot,
        stdio: 'inherit',
        timeout: 30000,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('No existing containers to clean up');
    }

    // Start the test environment
    // eslint-disable-next-line no-console
    console.log('📦 Starting Docker Compose services...');
    dockerProcess = spawn('docker-compose', ['-f', 'docker-compose.test.yml', 'up', '--build'], {
      cwd: projectRoot,
      stdio: 'pipe',
    });

    // Handle Docker Compose output
    dockerProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (output.includes('error') || output.includes('Error')) {
        // Using console.error is necessary for Docker error reporting in CI
        console.error('Docker Compose error:', output); // eslint-disable-line no-console
      }
    });

    dockerProcess.stderr?.on('data', (data: Buffer) => {
      // eslint-disable-next-line no-console
      console.error('Docker Compose stderr:', data.toString());
    });

    // Wait for services to be healthy
    // eslint-disable-next-line no-console
    console.log('⏳ Waiting for services to be ready...');
    await waitForServicesHealthy(projectRoot);

    // Seed test data
    // eslint-disable-next-line no-console
    console.log('🌱 Seeding test data...');
    seedTestData(projectRoot);

    // Verify services are accessible
    // eslint-disable-next-line no-console
    console.log('✅ Verifying service accessibility...');
    await verifyServices();

    // eslint-disable-next-line no-console
    console.log('✨ E2E test environment ready!');

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Failed to start E2E test environment:', error);
    
    // Cleanup on failure
    if (dockerProcess) {
      dockerProcess.kill();
    }
    
    try {
      execSync('docker-compose -f docker-compose.test.yml down -v', {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } catch (cleanupError) {
      // eslint-disable-next-line no-console
      console.error('Failed to cleanup:', cleanupError);
    }
    
    throw error;
  }
}

async function waitForServicesHealthy(projectRoot: string, maxWaitTime = 120000) {
  const startTime = Date.now();
  const checkInterval = 2000; // 2 seconds

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const result = execSync('docker-compose -f docker-compose.test.yml ps --format json', {
        cwd: projectRoot,
        encoding: 'utf8',
      });

      const services: Array<{ Service: string; State: string; Health?: string }> = result.trim().split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as { Service: string; State: string; Health?: string });

      const requiredServices = ['postgres-test', 'redis-test', 'api-test', 'web-test'];
      const healthyServices = services.filter(service => 
        requiredServices.includes(service.Service) && 
        (service.State === 'running' || service.Health === 'healthy')
      );

      if (healthyServices.length === requiredServices.length) {
        // eslint-disable-next-line no-console
        console.log('✅ All required services are healthy');
        return;
      }

      // eslint-disable-next-line no-console
      console.log(`⏳ Waiting for services... (${healthyServices.length}/${requiredServices.length} healthy)`);
      
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('⏳ Still waiting for services to start...');
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  throw new Error('Services failed to become healthy within the timeout period');
}

function seedTestData(projectRoot: string): void {
  try {
    execSync('docker-compose -f docker-compose.test.yml --profile seeder up test-seeder --abort-on-container-exit', {
      cwd: projectRoot,
      stdio: 'inherit',
      timeout: 60000,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Test data seeding failed or partially failed:', error);
    // Don't fail the setup if seeding fails
  }
}

async function verifyServices() {
  const services = [
    { name: 'API', url: 'http://localhost:3001/health', timeout: 5000 },
    { name: 'Web', url: 'http://localhost:3000/api/health', timeout: 5000 },
  ];

  for (const service of services) {
    const startTime = Date.now();
    let success = false;

    while (Date.now() - startTime < service.timeout) {
      try {
        const response = await fetch(service.url);
        if (response.ok) {
          // eslint-disable-next-line no-console
          console.log(`✅ ${service.name} service is accessible`);
          success = true;
          break;
        }
      } catch (error) {
        // Service not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!success) {
      throw new Error(`${service.name} service is not accessible at ${service.url}`);
    }
  }
}

// Setup browser state for authenticated tests (unused for now)
/*
async function setupAuthenticatedState() {
  // Create a browser instance to set up authentication
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to the app and perform authentication
    await page.goto('http://localhost:3000');
    
    // Mock authentication by setting localStorage/sessionStorage
    await page.evaluate(() => {
      // Set mock authentication tokens
      localStorage.setItem('next-auth.session-token', 'mock-session-token');
      sessionStorage.setItem('user', JSON.stringify({
        id: 'test-user-123',
        login: 'test-user',
        name: 'Test User',
        email: 'test@example.com',
        avatar_url: 'https://github.com/images/avatars/test-user.png',
      }));
    });

    // Save authenticated state
    await context.storageState({ path: 'playwright/.auth/user.json' });
    
    console.log('✅ Authenticated browser state saved');

  } catch (error) {
    console.error('❌ Failed to setup authenticated state:', error);
    // Don't fail setup if authentication setup fails
  } finally {
    await browser.close();
  }
}
*/

// Global setup function
export default globalSetup;