/**
 * Playwright E2E Test Configuration for FlakeGuard
 * 
 * End-to-end tests with full Docker Compose environment
 */

import path from 'path';

import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './src/__tests__/e2e',
  
  // Run tests in files in parallel
  fullyParallel: false, // Sequential to avoid Docker conflicts
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : 2,
  
  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }],
    ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
    ['list'],
  ],
  
  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Record video on failure
    video: 'retain-on-failure',
    
    // Screenshots on failure
    screenshot: 'only-on-failure',
    
    // API context
    extraHTTPHeaders: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  },

  // Test timeout
  timeout: 60000,
  expect: {
    timeout: 10000,
  },

  // Global setup and teardown
  globalSetup: path.resolve(__dirname, 'src/__tests__/e2e/global.setup.ts'),
  globalTeardown: path.resolve(__dirname, 'src/__tests__/e2e/global.teardown.ts'),

  // Configure projects for major browsers
  projects: [
    // API Testing
    {
      name: 'api',
      testDir: './src/__tests__/e2e/api',
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    // Web Dashboard Testing
    {
      name: 'web-chrome',
      testDir: './src/__tests__/e2e/web',
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    {
      name: 'web-firefox',
      testDir: './src/__tests__/e2e/web',
      use: {
        ...devices['Desktop Firefox'],
      },
    },

    // Mobile Testing
    {
      name: 'web-mobile',
      testDir: './src/__tests__/e2e/web',
      use: {
        ...devices['Pixel 5'],
      },
    },

    // GitHub Webhooks Testing
    {
      name: 'webhooks',
      testDir: './src/__tests__/e2e/webhooks',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  // Run your local dev server before starting the tests
  webServer: [
    {
      command: 'docker-compose -f docker-compose.test.yml up -d --wait',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'docker-compose -f docker-compose.test.yml exec api pnpm migrate:deploy',
      timeout: 30000,
    },
    {
      command: 'docker-compose -f docker-compose.test.yml exec api pnpm seed',
      timeout: 30000,
    },
  ],
});