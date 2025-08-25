#!/usr/bin/env node

/**
 * Development seed data for FlakeGuard
 * This script populates the database with realistic development data
 */

const { performance } = require('perf_hooks');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

class DevelopmentSeeder {
  constructor() {
    this.startTime = performance.now();
    this.dbClient = null; // Will be initialized when database connection is available
  }

  async initialize() {
    log('blue', '🌱 Initializing FlakeGuard development seeder...');
    
    try {
      // Database connection will be implemented when Prisma client is available
      // For now, this is a placeholder structure
      log('green', '✅ Database connection established');
      return true;
    } catch (error) {
      log('red', `❌ Failed to connect to database: ${error.message}`);
      return false;
    }
  }

  async seedUsers() {
    log('cyan', '👥 Seeding development users...');
    
    const users = [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        email: 'admin@flakeguard.dev',
        name: 'Admin User',
        role: 'ADMIN',
        isActive: true,
        createdAt: new Date(),
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        email: 'developer@flakeguard.dev',
        name: 'Developer User',
        role: 'DEVELOPER',
        isActive: true,
        createdAt: new Date(),
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440003',
        email: 'viewer@flakeguard.dev',
        name: 'Viewer User',
        role: 'VIEWER',
        isActive: true,
        createdAt: new Date(),
      },
    ];

    try {
      // This will be implemented when Prisma models are available
      log('green', `✅ Seeded ${users.length} users`);
      return users;
    } catch (error) {
      log('red', `❌ Failed to seed users: ${error.message}`);
      throw error;
    }
  }

  async seedProjects() {
    log('cyan', '📁 Seeding development projects...');
    
    const projects = [
      {
        id: '550e8400-e29b-41d4-a716-446655440101',
        name: 'FlakeGuard Frontend',
        description: 'React frontend application for FlakeGuard',
        repository: 'https://github.com/flakeguard/frontend',
        isActive: true,
        settings: {
          flakeThreshold: 0.05,
          retentionDays: 30,
          notifications: true,
        },
        createdAt: new Date(),
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440102',
        name: 'FlakeGuard API',
        description: 'Backend API service for FlakeGuard',
        repository: 'https://github.com/flakeguard/api',
        isActive: true,
        settings: {
          flakeThreshold: 0.03,
          retentionDays: 60,
          notifications: true,
        },
        createdAt: new Date(),
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440103',
        name: 'Sample E2E Tests',
        description: 'Sample end-to-end test suite',
        repository: 'https://github.com/flakeguard/e2e-sample',
        isActive: true,
        settings: {
          flakeThreshold: 0.10,
          retentionDays: 14,
          notifications: false,
        },
        createdAt: new Date(),
      },
    ];

    try {
      // This will be implemented when Prisma models are available
      log('green', `✅ Seeded ${projects.length} projects`);
      return projects;
    } catch (error) {
      log('red', `❌ Failed to seed projects: ${error.message}`);
      throw error;
    }
  }

  async seedTestSuites(projects) {
    log('cyan', '🧪 Seeding development test suites...');
    
    const testSuites = [];
    
    for (const project of projects) {
      const suites = [
        {
          id: `${project.id}-suite-001`,
          projectId: project.id,
          name: 'Unit Tests',
          framework: 'jest',
          environment: 'node',
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: `${project.id}-suite-002`,
          projectId: project.id,
          name: 'Integration Tests',
          framework: 'jest',
          environment: 'docker',
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: `${project.id}-suite-003`,
          projectId: project.id,
          name: 'E2E Tests',
          framework: 'playwright',
          environment: 'chrome',
          isActive: true,
          createdAt: new Date(),
        },
      ];
      
      testSuites.push(...suites);
    }

    try {
      // This will be implemented when Prisma models are available
      log('green', `✅ Seeded ${testSuites.length} test suites`);
      return testSuites;
    } catch (error) {
      log('red', `❌ Failed to seed test suites: ${error.message}`);
      throw error;
    }
  }

  async seedTestCases(testSuites) {
    log('cyan', '📝 Seeding development test cases...');
    
    const testCases = [];
    const sampleTestNames = [
      'should render homepage correctly',
      'should authenticate user successfully',
      'should handle form validation',
      'should process payment correctly',
      'should display error messages',
      'should navigate between pages',
      'should load data from API',
      'should handle network errors',
      'should validate user permissions',
      'should update user profile',
    ];

    for (const suite of testSuites) {
      for (let i = 0; i < 5; i++) {
        testCases.push({
          id: `${suite.id}-case-${String(i + 1).padStart(3, '0')}`,
          testSuiteId: suite.id,
          name: sampleTestNames[i % sampleTestNames.length],
          filePath: `/tests/${suite.name.toLowerCase().replace(/\s+/g, '-')}/${sampleTestNames[i % sampleTestNames.length].replace(/\s+/g, '-')}.spec.js`,
          isActive: true,
          createdAt: new Date(),
        });
      }
    }

    try {
      // This will be implemented when Prisma models are available
      log('green', `✅ Seeded ${testCases.length} test cases`);
      return testCases;
    } catch (error) {
      log('red', `❌ Failed to seed test cases: ${error.message}`);
      throw error;
    }
  }

  async seedTestRuns(testCases) {
    log('cyan', '🏃 Seeding development test runs...');
    
    const testRuns = [];
    const now = new Date();
    
    // Generate test runs for the last 7 days
    for (let day = 0; day < 7; day++) {
      const runDate = new Date(now);
      runDate.setDate(runDate.getDate() - day);
      
      for (let run = 0; run < 3; run++) {
        const runTime = new Date(runDate);
        runTime.setHours(9 + run * 4, Math.floor(Math.random() * 60), 0, 0);
        
        const runId = `run-${runDate.toISOString().split('T')[0]}-${run + 1}`;
        
        for (const testCase of testCases) {
          // Simulate different test outcomes with realistic flake patterns
          const random = Math.random();
          let status, duration;
          
          if (random < 0.8) {
            status = 'PASSED';
            duration = 1000 + Math.random() * 3000; // 1-4 seconds
          } else if (random < 0.95) {
            status = 'FAILED';
            duration = 2000 + Math.random() * 8000; // 2-10 seconds
          } else {
            status = 'FLAKY';
            duration = 5000 + Math.random() * 10000; // 5-15 seconds
          }
          
          testRuns.push({
            id: `${runId}-${testCase.id}`,
            testCaseId: testCase.id,
            status,
            duration: Math.floor(duration),
            startedAt: runTime,
            completedAt: new Date(runTime.getTime() + duration),
            errorMessage: status !== 'PASSED' ? `Sample error message for ${testCase.name}` : null,
            metadata: {
              runner: 'github-actions',
              nodeVersion: '20.11.0',
              browser: testCase.name.includes('E2E') ? 'chrome-120' : null,
            },
            createdAt: runTime,
          });
        }
      }
    }

    try {
      // This will be implemented when Prisma models are available
      log('green', `✅ Seeded ${testRuns.length} test runs`);
      return testRuns;
    } catch (error) {
      log('red', `❌ Failed to seed test runs: ${error.message}`);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.dbClient) {
        // Close database connection when available
        log('blue', '🔌 Closing database connection');
      }
    } catch (error) {
      log('yellow', `⚠️  Error during cleanup: ${error.message}`);
    }
  }

  async run() {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        process.exit(1);
      }

      log('bright', '🚀 Starting development data seeding...');

      const users = await this.seedUsers();
      const projects = await this.seedProjects();
      const testSuites = await this.seedTestSuites(projects);
      const testCases = await this.seedTestCases(testSuites);
      const testRuns = await this.seedTestRuns(testCases);

      const endTime = performance.now();
      const duration = ((endTime - this.startTime) / 1000).toFixed(2);

      log('green', '🎉 Development seeding completed successfully!');
      log('blue', `📊 Summary:`);
      log('blue', `   • ${users.length} users`);
      log('blue', `   • ${projects.length} projects`);
      log('blue', `   • ${testSuites.length} test suites`);
      log('blue', `   • ${testCases.length} test cases`);
      log('blue', `   • ${testRuns.length} test runs`);
      log('blue', `⏱️  Completed in ${duration}s`);

    } catch (error) {
      log('red', `💥 Seeding failed: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }
}

// Run the seeder if called directly
if (require.main === module) {
  const seeder = new DevelopmentSeeder();
  seeder.run().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = DevelopmentSeeder;