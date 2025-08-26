import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createTestDatabase, getSchemaInfo, validateTable, type MigrationTestContext } from './utils/migration-test-utils.js';

describe('Migration 02: JUnit Enhancement (20240824000001_enhance_test_models_for_junit_ingestion)', () => {
  let testDb: MigrationTestContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  describe('TestSuite Table Creation', () => {
    it('should create TestSuite table with correct structure', async () => {
      const { tables } = await getSchemaInfo(testDb.prisma);
      expect(tables).toContain('TestSuite');

      const expectedColumns = [
        'id', 'name', 'package', 'hostname', 'tests', 'failures',
        'errors', 'skipped', 'time', 'timestamp', 'runId', 'jobName',
        'repositoryId', 'checkRunId', 'workflowJobId', 'systemOut',
        'systemErr', 'properties', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'TestSuite', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should have correct indexes on TestSuite', async () => {
      const indexResult = await testDb.prisma.$queryRaw<Array<{ index_name: string }>>`
        SELECT i.relname as index_name
        FROM pg_class t, pg_class i, pg_index ix
        WHERE t.oid = ix.indrelid
        AND i.oid = ix.indexrelid
        AND t.relname = 'TestSuite'
        AND t.relkind = 'r'
        AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        ORDER BY i.relname
      `;

      const indexes = indexResult.map(row => row.index_name);
      
      // Check for expected indexes
      const expectedIndexes = [
        'TestSuite_name_idx',
        'TestSuite_repositoryId_idx',
        'TestSuite_checkRunId_idx',
        'TestSuite_workflowJobId_idx',
        'TestSuite_runId_idx',
        'TestSuite_repositoryId_name_idx',
        'TestSuite_createdAt_idx'
      ];

      expectedIndexes.forEach(expectedIndex => {
        expect(indexes).toContain(expectedIndex);
      });
    });
  });

  describe('TestResult Table Enhancement', () => {
    it('should have enhanced TestResult structure', async () => {
      const expectedColumns = [
        'id', 'name', 'suite', 'class', 'testFullName', 'file', 
        'status', 'time', 'message', 'stack', 'attempt', 'runId', 
        'jobName', 'repositoryId', 'testSuiteId', 'checkRunId',
        'workflowJobId', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'TestResult', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should have correct foreign key to TestSuite', async () => {
      const foreignKeys = await testDb.prisma.$queryRaw<Array<{
        table_name: string;
        column_name: string;
        foreign_table_name: string;
        foreign_column_name: string;
      }>>`
        SELECT 
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name 
        FROM information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu 
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu 
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'TestResult'
        AND kcu.column_name = 'testSuiteId'
      `;

      expect(foreignKeys.length).toBeGreaterThan(0);
      expect(foreignKeys[0].foreign_table_name).toBe('TestSuite');
      expect(foreignKeys[0].foreign_column_name).toBe('id');
    });
  });

  describe('Data Operations', () => {
    it('should allow creating TestSuite and related TestResults', async () => {
      // Create test installation and repository first
      const installation = await testDb.prisma.installation.create({
        data: {
          id: 'test-installation',
          githubInstallationId: 12345,
          accountLogin: 'testorg',
          accountId: 12345,
          accountType: 'Organization'
        }
      });

      const repository = await testDb.prisma.repository.create({
        data: {
          githubId: 54321,
          nodeId: 'R_test123',
          name: 'test-repo',
          fullName: 'testorg/test-repo',
          owner: 'testorg',
          installationId: installation.id
        }
      });

      // Create TestSuite
      const testSuite = await testDb.prisma.testSuite.create({
        data: {
          name: 'com.example.TestSuite',
          package: 'com.example',
          tests: 5,
          failures: 1,
          errors: 0,
          skipped: 1,
          time: 1.23,
          timestamp: '2024-08-24T10:30:00Z',
          runId: 'run-123',
          jobName: 'test-job',
          repositoryId: repository.id,
          systemOut: 'System output',
          systemErr: 'System error',
          properties: { env: 'test' }
        }
      });

      expect(testSuite.id).toBeDefined();
      expect(testSuite.name).toBe('com.example.TestSuite');
      expect(testSuite.tests).toBe(5);

      // Create TestResult linked to TestSuite
      const testResult = await testDb.prisma.testResult.create({
        data: {
          name: 'testMethod',
          suite: 'com.example.TestSuite',
          class: 'TestClass',
          testFullName: 'com.example.TestSuite.TestClass.testMethod',
          file: 'TestClass.java',
          status: 'failed',
          time: 0.5,
          message: 'Assertion failed',
          stack: 'at TestClass.testMethod(TestClass.java:15)',
          attempt: 1,
          runId: 'run-123',
          jobName: 'test-job',
          repositoryId: repository.id,
          testSuiteId: testSuite.id
        }
      });

      expect(testResult.id).toBeDefined();
      expect(testResult.testSuiteId).toBe(testSuite.id);

      // Test relationship
      const suiteWithResults = await testDb.prisma.testSuite.findUnique({
        where: { id: testSuite.id },
        include: { testResults: true }
      });

      expect(suiteWithResults?.testResults).toHaveLength(1);
      expect(suiteWithResults?.testResults[0].id).toBe(testResult.id);

      // Cleanup
      await testDb.prisma.testResult.delete({ where: { id: testResult.id } });
      await testDb.prisma.testSuite.delete({ where: { id: testSuite.id } });
      await testDb.prisma.repository.delete({ where: { id: repository.id } });
      await testDb.prisma.installation.delete({ where: { id: installation.id } });
    });

    it('should enforce unique constraint on TestSuite', async () => {
      const installation = await testDb.prisma.installation.create({
        data: {
          id: 'test-installation-2',
          githubInstallationId: 12346,
          accountLogin: 'testorg2',
          accountId: 12346,
          accountType: 'Organization'
        }
      });

      const repository = await testDb.prisma.repository.create({
        data: {
          githubId: 54322,
          nodeId: 'R_test124',
          name: 'test-repo-2',
          fullName: 'testorg2/test-repo-2',
          owner: 'testorg2',
          installationId: installation.id
        }
      });

      const testSuiteData = {
        name: 'com.example.UniqueTestSuite',
        repositoryId: repository.id,
        runId: 'run-456',
        tests: 3
      };

      await testDb.prisma.testSuite.create({ data: testSuiteData });

      // Try to create duplicate TestSuite
      await expect(
        testDb.prisma.testSuite.create({ data: testSuiteData })
      ).rejects.toThrow();

      // Cleanup
      await testDb.prisma.testSuite.deleteMany({
        where: { name: 'com.example.UniqueTestSuite' }
      });
      await testDb.prisma.repository.delete({ where: { id: repository.id } });
      await testDb.prisma.installation.delete({ where: { id: installation.id } });
    });
  });

  describe('Enhanced TestResult Features', () => {
    it('should support JUnit-specific fields', async () => {
      const installation = await testDb.prisma.installation.create({
        data: {
          id: 'junit-test-installation',
          githubInstallationId: 12347,
          accountLogin: 'junit-org',
          accountId: 12347,
          accountType: 'Organization'
        }
      });

      const repository = await testDb.prisma.repository.create({
        data: {
          githubId: 54323,
          nodeId: 'R_junit123',
          name: 'junit-repo',
          fullName: 'junit-org/junit-repo',
          owner: 'junit-org',
          installationId: installation.id
        }
      });

      // Test all JUnit specific fields
      const testResult = await testDb.prisma.testResult.create({
        data: {
          name: 'testWithAllFields',
          suite: 'JUnitTestSuite',
          class: 'org.example.JUnitTest',
          testFullName: 'JUnitTestSuite.org.example.JUnitTest.testWithAllFields',
          file: 'src/test/java/org/example/JUnitTest.java',
          status: 'failed',
          time: 2.5,
          message: 'Expected: <5> but was: <3>',
          stack: `java.lang.AssertionError: Expected: <5> but was: <3>
    at org.junit.Assert.fail(Assert.java:88)
    at org.example.JUnitTest.testWithAllFields(JUnitTest.java:25)`,
          attempt: 2,
          runId: 'junit-run-789',
          jobName: 'junit-test-job',
          repositoryId: repository.id
        }
      });

      expect(testResult.suite).toBe('JUnitTestSuite');
      expect(testResult.class).toBe('org.example.JUnitTest');
      expect(testResult.testFullName).toBe('JUnitTestSuite.org.example.JUnitTest.testWithAllFields');
      expect(testResult.file).toBe('src/test/java/org/example/JUnitTest.java');
      expect(testResult.time).toBe(2.5);
      expect(testResult.attempt).toBe(2);

      // Cleanup
      await testDb.prisma.testResult.delete({ where: { id: testResult.id } });
      await testDb.prisma.repository.delete({ where: { id: repository.id } });
      await testDb.prisma.installation.delete({ where: { id: installation.id } });
    });

    it('should handle test retries with attempt field', async () => {
      const installation = await testDb.prisma.installation.create({
        data: {
          id: 'retry-test-installation',
          githubInstallationId: 12348,
          accountLogin: 'retry-org',
          accountId: 12348,
          accountType: 'Organization'
        }
      });

      const repository = await testDb.prisma.repository.create({
        data: {
          githubId: 54324,
          nodeId: 'R_retry123',
          name: 'retry-repo',
          fullName: 'retry-org/retry-repo',
          owner: 'retry-org',
          installationId: installation.id
        }
      });

      // Create multiple attempts of the same test
      const attempt1 = await testDb.prisma.testResult.create({
        data: {
          name: 'flakyTest',
          suite: 'FlakyTestSuite',
          testFullName: 'FlakyTestSuite.flakyTest.attempt1',
          status: 'failed',
          time: 1.0,
          attempt: 1,
          runId: 'retry-run-001',
          repositoryId: repository.id
        }
      });

      const attempt2 = await testDb.prisma.testResult.create({
        data: {
          name: 'flakyTest',
          suite: 'FlakyTestSuite', 
          testFullName: 'FlakyTestSuite.flakyTest.attempt2',
          status: 'passed',
          time: 1.2,
          attempt: 2,
          runId: 'retry-run-001',
          repositoryId: repository.id
        }
      });

      expect(attempt1.attempt).toBe(1);
      expect(attempt2.attempt).toBe(2);

      // Query by attempt
      const failedAttempts = await testDb.prisma.testResult.findMany({
        where: {
          name: 'flakyTest',
          status: 'failed'
        }
      });

      const passedAttempts = await testDb.prisma.testResult.findMany({
        where: {
          name: 'flakyTest',
          status: 'passed'
        }
      });

      expect(failedAttempts).toHaveLength(1);
      expect(passedAttempts).toHaveLength(1);

      // Cleanup
      await testDb.prisma.testResult.deleteMany({
        where: { name: 'flakyTest' }
      });
      await testDb.prisma.repository.delete({ where: { id: repository.id } });
      await testDb.prisma.installation.delete({ where: { id: installation.id } });
    });
  });
});