import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createTestDatabase, getSchemaInfo, validateTable, validateForeignKeys, validateIndexes, type MigrationTestContext } from './utils/migration-test-utils';

describe('Migration 01: Initial Schema (20240824000000_init)', () => {
  let testDb: MigrationTestContext;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  describe('Table Creation', () => {
    it('should create all expected tables', async () => {
      const { tables } = await getSchemaInfo(testDb.prisma);
      
      const expectedTables = [
        'User', 'Task', 'Installation', 'Repository', 'CheckRun',
        'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection',
        '_prisma_migrations' // Prisma system table
      ];

      expectedTables.forEach(tableName => {
        expect(tables).toContain(tableName);
      });
    });

    it('should create User table with correct structure', async () => {
      const expectedColumns = [
        'id', 'email', 'name', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'User', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create Task table with correct structure', async () => {
      const expectedColumns = [
        'id', 'title', 'description', 'status', 'priority', 
        'userId', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'Task', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create Installation table with correct structure', async () => {
      const expectedColumns = [
        'id', 'githubInstallationId', 'accountLogin', 'accountId', 
        'accountType', 'repositorySelection', 'permissions', 'events',
        'createdAt', 'updatedAt', 'suspendedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'Installation', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create Repository table with correct structure', async () => {
      const expectedColumns = [
        'id', 'githubId', 'nodeId', 'name', 'fullName', 'owner',
        'private', 'defaultBranch', 'installationId', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'Repository', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create CheckRun table with correct structure', async () => {
      const expectedColumns = [
        'id', 'githubId', 'name', 'headSha', 'status', 'conclusion',
        'startedAt', 'completedAt', 'repositoryId', 'installationId',
        'workflowRunId', 'output', 'actions', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'CheckRun', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create WorkflowRun table with correct structure', async () => {
      const expectedColumns = [
        'id', 'githubId', 'name', 'headBranch', 'headSha', 'status',
        'conclusion', 'workflowId', 'workflowName', 'repositoryId',
        'installationId', 'runStartedAt', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'WorkflowRun', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create TestResult table with correct structure', async () => {
      const expectedColumns = [
        'id', 'name', 'status', 'duration', 'errorMessage', 'stackTrace',
        'repositoryId', 'checkRunId', 'workflowJobId', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'TestResult', expectedColumns);
      expect(isValid).toBe(true);
    });

    it('should create FlakeDetection table with correct structure', async () => {
      const expectedColumns = [
        'id', 'testName', 'repositoryId', 'installationId', 'checkRunId',
        'testResultId', 'isFlaky', 'confidence', 'failurePattern',
        'historicalFailures', 'totalRuns', 'failureRate', 'lastFailureAt',
        'suggestedAction', 'status', 'createdAt', 'updatedAt'
      ];
      
      const isValid = await validateTable(testDb.prisma, 'FlakeDetection', expectedColumns);
      expect(isValid).toBe(true);
    });
  });

  describe('Enum Creation', () => {
    it('should create TaskStatus enum', async () => {
      const { enums } = await getSchemaInfo(testDb.prisma);
      expect(enums).toContain('TaskStatus');

      // Test enum values
      const enumValues = await testDb.prisma.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT enumlabel 
        FROM pg_enum 
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'TaskStatus')
        ORDER BY enumsortorder
      `;
      
      const values = enumValues.map(row => row.enumlabel);
      expect(values).toEqual(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']);
    });

    it('should create Priority enum', async () => {
      const { enums } = await getSchemaInfo(testDb.prisma);
      expect(enums).toContain('Priority');

      // Test enum values
      const enumValues = await testDb.prisma.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT enumlabel 
        FROM pg_enum 
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'Priority')
        ORDER BY enumsortorder
      `;
      
      const values = enumValues.map(row => row.enumlabel);
      expect(values).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    });
  });

  describe('Index Creation', () => {
    it('should create unique indexes', async () => {
      const uniqueIndexes = [
        { table: 'User', index: 'User_email_key' },
        { table: 'Installation', index: 'Installation_githubInstallationId_key' },
        { table: 'Repository', index: 'Repository_githubId_key' },
        { table: 'CheckRun', index: 'CheckRun_githubId_key' },
        { table: 'WorkflowRun', index: 'WorkflowRun_githubId_key' },
        { table: 'WorkflowJob', index: 'WorkflowJob_githubId_key' },
        { table: 'Artifact', index: 'Artifact_githubId_key' },
        { table: 'FlakeDetection', index: 'FlakeDetection_testName_repositoryId_key' }
      ];

      for (const { table, index } of uniqueIndexes) {
        const hasIndex = await validateIndexes(testDb.prisma, table, [index]);
        expect(hasIndex, `Missing unique index ${index} on table ${table}`).toBe(true);
      }
    });

    it('should create performance indexes', async () => {
      const performanceIndexes = [
        { table: 'Task', indexes: ['Task_userId_idx', 'Task_status_idx'] },
        { table: 'Installation', indexes: ['Installation_githubInstallationId_idx', 'Installation_accountLogin_idx'] },
        { table: 'Repository', indexes: ['Repository_githubId_idx', 'Repository_fullName_idx', 'Repository_installationId_idx'] },
        { table: 'CheckRun', indexes: ['CheckRun_githubId_idx', 'CheckRun_headSha_idx', 'CheckRun_status_idx', 'CheckRun_conclusion_idx', 'CheckRun_repositoryId_idx', 'CheckRun_workflowRunId_idx'] },
        { table: 'WorkflowRun', indexes: ['WorkflowRun_githubId_idx', 'WorkflowRun_status_idx', 'WorkflowRun_conclusion_idx', 'WorkflowRun_repositoryId_idx', 'WorkflowRun_workflowId_idx'] },
        { table: 'TestResult', indexes: ['TestResult_name_idx', 'TestResult_status_idx', 'TestResult_repositoryId_idx', 'TestResult_checkRunId_idx'] },
        { table: 'FlakeDetection', indexes: ['FlakeDetection_testName_idx', 'FlakeDetection_repositoryId_idx', 'FlakeDetection_isFlaky_idx', 'FlakeDetection_status_idx', 'FlakeDetection_confidence_idx'] }
      ];

      for (const { table, indexes } of performanceIndexes) {
        const hasIndexes = await validateIndexes(testDb.prisma, table, indexes);
        expect(hasIndexes, `Missing performance indexes on table ${table}: ${indexes.join(', ')}`).toBe(true);
      }
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should create all foreign key constraints', async () => {
      const expectedForeignKeys = [
        { table: 'Task', column: 'userId', referencedTable: 'User', referencedColumn: 'id' },
        { table: 'Repository', column: 'installationId', referencedTable: 'Installation', referencedColumn: 'id' },
        { table: 'CheckRun', column: 'repositoryId', referencedTable: 'Repository', referencedColumn: 'id' },
        { table: 'CheckRun', column: 'installationId', referencedTable: 'Installation', referencedColumn: 'id' },
        { table: 'CheckRun', column: 'workflowRunId', referencedTable: 'WorkflowRun', referencedColumn: 'id' },
        { table: 'WorkflowRun', column: 'repositoryId', referencedTable: 'Repository', referencedColumn: 'id' },
        { table: 'WorkflowRun', column: 'installationId', referencedTable: 'Installation', referencedColumn: 'id' },
        { table: 'WorkflowJob', column: 'workflowRunId', referencedTable: 'WorkflowRun', referencedColumn: 'id' },
        { table: 'Artifact', column: 'workflowRunId', referencedTable: 'WorkflowRun', referencedColumn: 'id' },
        { table: 'TestResult', column: 'repositoryId', referencedTable: 'Repository', referencedColumn: 'id' },
        { table: 'TestResult', column: 'checkRunId', referencedTable: 'CheckRun', referencedColumn: 'id' },
        { table: 'TestResult', column: 'workflowJobId', referencedTable: 'WorkflowJob', referencedColumn: 'id' },
        { table: 'FlakeDetection', column: 'repositoryId', referencedTable: 'Repository', referencedColumn: 'id' },
        { table: 'FlakeDetection', column: 'installationId', referencedTable: 'Installation', referencedColumn: 'id' },
        { table: 'FlakeDetection', column: 'checkRunId', referencedTable: 'CheckRun', referencedColumn: 'id' },
        { table: 'FlakeDetection', column: 'testResultId', referencedTable: 'TestResult', referencedColumn: 'id' }
      ];

      const isValid = await validateForeignKeys(testDb.prisma, expectedForeignKeys);
      expect(isValid).toBe(true);
    });
  });

  describe('Data Operations', () => {
    it('should allow basic CRUD operations', async () => {
      // Create a user
      const user = await testDb.prisma.user.create({
        data: {
          email: 'test@example.com',
          name: 'Test User'
        }
      });
      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');

      // Create an installation
      const installation = await testDb.prisma.installation.create({
        data: {
          id: 'test-installation',
          githubInstallationId: 12345,
          accountLogin: 'testorg',
          accountId: 12345,
          accountType: 'Organization'
        }
      });
      expect(installation.githubInstallationId).toBe(12345);

      // Create a repository
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
      expect(repository.name).toBe('test-repo');

      // Create a task
      const task = await testDb.prisma.task.create({
        data: {
          title: 'Test Task',
          description: 'A test task',
          status: 'PENDING',
          priority: 'MEDIUM',
          userId: user.id
        }
      });
      expect(task.title).toBe('Test Task');

      // Cleanup
      await testDb.prisma.task.delete({ where: { id: task.id } });
      await testDb.prisma.repository.delete({ where: { id: repository.id } });
      await testDb.prisma.installation.delete({ where: { id: installation.id } });
      await testDb.prisma.user.delete({ where: { id: user.id } });
    });

    it('should enforce unique constraints', async () => {
      const userData = {
        email: 'unique@example.com',
        name: 'Unique User'
      };

      await testDb.prisma.user.create({ data: userData });

      // Try to create duplicate user
      await expect(
        testDb.prisma.user.create({ data: userData })
      ).rejects.toThrow();

      // Cleanup
      await testDb.prisma.user.delete({ where: { email: userData.email } });
    });

    it('should enforce foreign key constraints', async () => {
      // Try to create task with non-existent user
      await expect(
        testDb.prisma.task.create({
          data: {
            title: 'Invalid Task',
            userId: 'non-existent-user-id'
          }
        })
      ).rejects.toThrow();
    });
  });
});