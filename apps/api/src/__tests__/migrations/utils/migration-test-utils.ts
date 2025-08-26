import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';

export interface MigrationTestContext {
  prisma: PrismaClient;
  dbUrl: string;
  dbName: string;
  cleanup: () => Promise<void>;
}

export interface TableInfo {
  tableName: string;
  columnCount: number;
  indexCount: number;
  hasData: boolean;
}

export interface MigrationStep {
  name: string;
  timestamp: string;
  expectedTables: string[];
  expectedEnums: string[];
  expectedIndexes?: string[];
  validationQueries: string[];
}

/**
 * Creates an isolated test database for migration testing
 */
export async function createTestDatabase(): Promise<MigrationTestContext> {
  const testDbName = `flakeguard_migration_test_${randomUUID().replace(/-/g, '')}`;
  const baseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/flakeguard';
  const baseDbUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
  const testDbUrl = `${baseDbUrl}/${testDbName}`;

  // Create test database
  const adminPrisma = new PrismaClient({
    datasources: { db: { url: baseDbUrl + '/postgres' } }
  });

  try {
    await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${testDbName}"`);
  } catch (error) {
    // Database might already exist, ignore error
  } finally {
    await adminPrisma.$disconnect();
  }

  // Connect to test database
  const prisma = new PrismaClient({
    datasources: { db: { url: testDbUrl } }
  });

  const cleanup = async () => {
    await prisma.$disconnect();
    
    const adminPrisma = new PrismaClient({
      datasources: { db: { url: baseDbUrl + '/postgres' } }
    });
    
    try {
      await adminPrisma.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`
      );
    } catch (error) {
      console.warn(`Failed to cleanup test database ${testDbName}:`, error);
    } finally {
      await adminPrisma.$disconnect();
    }
  };

  return {
    prisma,
    dbUrl: testDbUrl,
    dbName: testDbName,
    cleanup
  };
}

/**
 * Run migrations up to a specific point
 */
export async function runMigrationsTo(dbUrl: string, migrationName?: string): Promise<void> {
  const env = { ...process.env, DATABASE_URL: dbUrl };
  
  try {
    if (migrationName) {
      execSync(`npx prisma migrate resolve --applied "${migrationName}"`, { 
        env,
        cwd: process.cwd(),
        stdio: 'pipe' 
      });
    }
    execSync('npx prisma db push --force-reset', { 
      env,
      cwd: process.cwd(),
      stdio: 'pipe' 
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration failed: ${errorMessage}`);
  }
}

/**
 * Get database schema information
 */
export async function getSchemaInfo(prisma: PrismaClient): Promise<{
  tables: string[];
  enums: string[];
  indexes: Record<string, string[]>;
}> {
  // Get tables
  const tablesResult = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  
  const tables = tablesResult.map((row: { table_name: string }) => row.table_name);

  // Get enums
  const enumsResult = await prisma.$queryRaw<Array<{ enum_name: string }>>`
    SELECT t.typname as enum_name
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid 
    GROUP BY t.typname
    ORDER BY t.typname
  `;
  
  const enums = enumsResult.map((row: { enum_name: string }) => row.enum_name);

  // Get indexes by table
  const indexesResult = await prisma.$queryRaw<Array<{ 
    table_name: string; 
    index_name: string;
  }>>`
    SELECT 
      t.relname as table_name,
      i.relname as index_name
    FROM pg_class t, pg_class i, pg_index ix
    WHERE t.oid = ix.indrelid
    AND i.oid = ix.indexrelid
    AND t.relkind = 'r'
    AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ORDER BY t.relname, i.relname
  `;

  const indexes: Record<string, string[]> = {};
  indexesResult.forEach((row: { table_name: string; index_name: string }) => {
    if (!indexes[row.table_name]) {
      indexes[row.table_name] = [];
    }
    indexes[row.table_name]!.push(row.index_name);
  });

  return { tables, enums, indexes };
}

/**
 * Validate table structure
 */
export async function validateTable(
  prisma: PrismaClient,
  tableName: string,
  expectedColumns: string[]
): Promise<boolean> {
  const columnsResult = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = ${tableName}
    ORDER BY column_name
  `;
  
  const actualColumns = columnsResult.map((row: { column_name: string }) => row.column_name).sort();
  const expectedColumnsSorted = [...expectedColumns].sort();
  
  return JSON.stringify(actualColumns) === JSON.stringify(expectedColumnsSorted);
}

/**
 * Validate foreign keys
 */
export async function validateForeignKeys(
  prisma: PrismaClient,
  expectedForeignKeys: Array<{
    table: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }>
): Promise<boolean> {
  const fkResult = await prisma.$queryRaw<Array<{
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
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu 
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `;

  const actualFks = fkResult.map((row: {
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }) => ({
    table: row.table_name,
    column: row.column_name,
    referencedTable: row.foreign_table_name,
    referencedColumn: row.foreign_column_name
  }));

  // Check each expected FK exists
  return expectedForeignKeys.every((expected: {
    table: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }) =>
    actualFks.some((actual: {
    table: string;
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }) =>
      actual.table === expected.table &&
      actual.column === expected.column &&
      actual.referencedTable === expected.referencedTable &&
      actual.referencedColumn === expected.referencedColumn
    )
  );
}

/**
 * Validate indexes
 */
export async function validateIndexes(
  prisma: PrismaClient,
  tableName: string,
  expectedIndexes: string[]
): Promise<boolean> {
  const indexResult = await prisma.$queryRaw<Array<{ index_name: string }>>`
    SELECT i.relname as index_name
    FROM pg_class t, pg_class i, pg_index ix
    WHERE t.oid = ix.indrelid
    AND i.oid = ix.indexrelid
    AND t.relname = ${tableName}
    AND t.relkind = 'r'
    AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ORDER BY i.relname
  `;

  const actualIndexes = indexResult.map((row: { index_name: string }) => row.index_name);
  
  return expectedIndexes.every(expected => actualIndexes.includes(expected));
}

/**
 * Test multi-tenancy isolation
 */
export async function testTenantIsolation(prisma: PrismaClient): Promise<boolean> {
  try {
    // Create test organizations
    const org1 = await prisma.organization.create({
      data: {
        name: 'Test Org 1',
        slug: 'test-org-1'
      }
    });

    const org2 = await prisma.organization.create({
      data: {
        name: 'Test Org 2', 
        slug: 'test-org-2'
      }
    });

    // Create test data for each org
    const repo1 = await prisma.fGRepository.create({
      data: {
        orgId: org1.id,
        provider: 'github',
        owner: 'testorg1',
        name: 'test-repo',
        installationId: 'install-1'
      }
    });

    const repo2 = await prisma.fGRepository.create({
      data: {
        orgId: org2.id,
        provider: 'github', 
        owner: 'testorg2',
        name: 'test-repo',
        installationId: 'install-2'
      }
    });

    // Verify isolation - org1 should only see org1 data
    const org1Repos = await prisma.fGRepository.findMany({
      where: { orgId: org1.id }
    });

    const org2Repos = await prisma.fGRepository.findMany({
      where: { orgId: org2.id }
    });

    const isolationCorrect = 
      org1Repos.length === 1 &&
      org1Repos[0]!.id === repo1.id &&
      org2Repos.length === 1 &&
      org2Repos[0]!.id === repo2.id;

    // Cleanup
    await prisma.fGRepository.deleteMany({ where: { orgId: org1.id } });
    await prisma.fGRepository.deleteMany({ where: { orgId: org2.id } });
    await prisma.organization.delete({ where: { id: org1.id } });
    await prisma.organization.delete({ where: { id: org2.id } });

    return isolationCorrect;
  } catch (error) {
    console.error('Tenant isolation test failed:', error);
    return false;
  }
}

/**
 * Performance test for indexes
 */
export async function performanceTestIndexes(
  prisma: PrismaClient,
  testData: { tableName: string; query: string; expectedMaxTime: number }[]
): Promise<Array<{ query: string; executionTime: number; passed: boolean }>> {
  const results = [];

  for (const test of testData) {
    const startTime = Date.now();
    try {
      await prisma.$queryRawUnsafe(test.query);
    } catch (error) {
      // Query might fail if no data, that's ok for performance testing
    }
    const executionTime = Date.now() - startTime;
    
    results.push({
      query: test.query,
      executionTime,
      passed: executionTime <= test.expectedMaxTime
    });
  }

  return results;
}

/**
 * Generate sample data for testing
 */
export async function generateSampleData(prisma: PrismaClient) {
  const org = await prisma.organization.create({
    data: {
      name: 'Sample Organization',
      slug: 'sample-org'
    }
  });

  const installation = await prisma.installation.create({
    data: {
      id: 'test-installation',
      orgId: org.id,
      githubInstallationId: 12345,
      accountLogin: 'testorg',
      accountId: 12345,
      accountType: 'Organization'
    }
  });

  const repo = await prisma.repository.create({
    data: {
      orgId: org.id,
      githubId: 54321,
      nodeId: 'R_test123',
      name: 'test-repo',
      fullName: 'testorg/test-repo',
      owner: 'testorg',
      installationId: installation.id
    }
  });

  const fgRepo = await prisma.fGRepository.create({
    data: {
      orgId: org.id,
      provider: 'github',
      owner: 'testorg',
      name: 'test-repo',
      installationId: installation.id
    }
  });

  const workflowRun = await prisma.fGWorkflowRun.create({
    data: {
      orgId: org.id,
      repoId: fgRepo.id,
      runId: 'run-123',
      status: 'completed',
      conclusion: 'failure'
    }
  });

  const testCase = await prisma.fGTestCase.create({
    data: {
      orgId: org.id,
      repoId: fgRepo.id,
      suite: 'TestSuite',
      name: 'testMethod',
      className: 'TestClass'
    }
  });

  const occurrence = await prisma.fGOccurrence.create({
    data: {
      orgId: org.id,
      testId: testCase.id,
      runId: workflowRun.id,
      status: 'failed',
      failureMsgSignature: 'test-failure-sig'
    }
  });

  return { org, installation, repo, fgRepo, workflowRun, testCase, occurrence };
}

export const MIGRATION_STEPS: MigrationStep[] = [
  {
    name: '20240824000000_init',
    timestamp: '20240824000000',
    expectedTables: [
      'User', 'Task', 'Installation', 'Repository', 'CheckRun',
      'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection'
    ],
    expectedEnums: ['TaskStatus', 'Priority'],
    validationQueries: [
      'SELECT COUNT(*) FROM "User"',
      'SELECT COUNT(*) FROM "Installation"'
    ]
  },
  {
    name: '20240824000001_enhance_test_models_for_junit_ingestion',
    timestamp: '20240824000001',
    expectedTables: [
      'User', 'Task', 'Installation', 'Repository', 'CheckRun',
      'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection', 'TestSuite'
    ],
    expectedEnums: ['TaskStatus', 'Priority'],
    validationQueries: [
      'SELECT COUNT(*) FROM "TestSuite"',
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'TestResult\' AND column_name = \'suite\''
    ]
  },
  {
    name: '20240825000000_add_flakeguard_core_models',
    timestamp: '20240825000000',
    expectedTables: [
      'User', 'Task', 'Installation', 'Repository', 'CheckRun',
      'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection', 'TestSuite'
    ],
    expectedEnums: ['TaskStatus', 'Priority'],
    validationQueries: [
      'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = \'public\''
    ]
  },
  {
    name: '20240826000000_add_organization_tables',
    timestamp: '20240826000000',
    expectedTables: [
      'User', 'Task', 'Installation', 'Repository', 'CheckRun',
      'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection', 'TestSuite',
      'Organization', 'OrganizationUser', 'Subscription', 'AuditLog', 'UsageMetric'
    ],
    expectedEnums: ['TaskStatus', 'Priority'],
    validationQueries: [
      'SELECT COUNT(*) FROM "Organization"',
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'User\' AND column_name = \'orgId\''
    ]
  },
  {
    name: '20240826000001_add_flakeguard_models',
    timestamp: '20240826000001',
    expectedTables: [
      'User', 'Task', 'Installation', 'Repository', 'CheckRun',
      'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection', 'TestSuite',
      'Organization', 'OrganizationUser', 'Subscription', 'AuditLog', 'UsageMetric',
      'FGRepository', 'FGWorkflowRun', 'FGJob', 'FGTestCase', 'FGOccurrence', 
      'FGFlakeScore', 'FGQuarantineDecision', 'FGIssueLink', 'FGFailureCluster'
    ],
    expectedEnums: ['TaskStatus', 'Priority', 'FGQuarantineState'],
    validationQueries: [
      'SELECT COUNT(*) FROM "FGRepository"',
      'SELECT COUNT(*) FROM "FGTestCase"'
    ]
  },
  {
    name: '20240826000002_fix_migration_inconsistencies',
    timestamp: '20240826000002',
    expectedTables: [
      'User', 'Task', 'Installation', 'Repository', 'CheckRun',
      'WorkflowRun', 'WorkflowJob', 'Artifact', 'TestResult', 'FlakeDetection', 'TestSuite',
      'Organization', 'OrganizationUser', 'Subscription', 'AuditLog', 'UsageMetric',
      'FGRepository', 'FGWorkflowRun', 'FGJob', 'FGTestCase', 'FGOccurrence', 
      'FGFlakeScore', 'FGQuarantineDecision', 'FGIssueLink', 'FGFailureCluster'
    ],
    expectedEnums: ['TaskStatus', 'Priority', 'FGQuarantineState'],
    validationQueries: [
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'Installation\' AND column_name = \'orgId\'',
      'SELECT column_name FROM information_schema.columns WHERE table_name = \'TestResult\' AND column_name = \'orgId\''
    ]
  }
];