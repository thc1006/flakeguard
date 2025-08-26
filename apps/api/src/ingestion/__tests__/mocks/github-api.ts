/**
 * Mock GitHub API Responses for Testing
 * 
 * Provides realistic mock data for:
 * - Workflow run details
 * - Artifact listings
 * - Artifact downloads
 * - Error responses
 * - Rate limiting scenarios
 */

import { vi } from 'vitest';

// ============================================================================
// Mock Data Types
// ============================================================================

export interface MockArtifact {
  id: number;
  node_id: string;
  name: string;
  size_in_bytes: number;
  url: string;
  archive_download_url: string;
  expired: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
  workflow_run?: {
    id: number;
    repository_id: number;
    head_repository_id: number;
    head_branch: string;
    head_sha: string;
  };
}

export interface MockWorkflowRun {
  id: number;
  name: string;
  node_id: string;
  head_branch: string;
  head_sha: string;
  path: string;
  display_title: string;
  run_number: number;
  event: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  workflow_id: number;
  check_suite_id: number;
  check_suite_node_id: string;
  url: string;
  html_url: string;
  pull_requests: any[];
  created_at: string;
  updated_at: string;
  actor: {
    login: string;
    id: number;
    node_id: string;
    avatar_url: string;
    gravatar_id: string;
    url: string;
    html_url: string;
    type: string;
    site_admin: boolean;
  };
  run_attempt: number;
  referenced_workflows: any[];
  run_started_at: string;
  triggering_actor: {
    login: string;
    id: number;
    node_id: string;
    avatar_url: string;
    gravatar_id: string;
    url: string;
    html_url: string;
    type: string;
    site_admin: boolean;
  };
  jobs_url: string;
  logs_url: string;
  check_suite_url: string;
  artifacts_url: string;
  cancel_url: string;
  rerun_url: string;
  previous_attempt_url: string | null;
  workflow_url: string;
  head_commit: {
    id: string;
    tree_id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
    committer: {
      name: string;
      email: string;
    };
  };
  repository: {
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
    owner: {
      login: string;
      id: number;
      node_id: string;
      avatar_url: string;
      gravatar_id: string;
      url: string;
      html_url: string;
      type: string;
      site_admin: boolean;
    };
    html_url: string;
    description: string;
    fork: boolean;
    url: string;
  };
  head_repository: {
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
    owner: {
      login: string;
      id: number;
      node_id: string;
      avatar_url: string;
      gravatar_id: string;
      url: string;
      html_url: string;
      type: string;
      site_admin: boolean;
    };
    html_url: string;
    description: string;
    fork: boolean;
    url: string;
  };
}

export interface MockRateLimitResponse {
  message: string;
  documentation_url: string;
}

// ============================================================================
// Mock Artifact Data
// ============================================================================

export const MOCK_ARTIFACTS: MockArtifact[] = [
  {
    id: 1234567890,
    node_id: 'MDg6QXJ0aWZhY3QxMjM0NTY3ODkw',
    name: 'test-results',
    size_in_bytes: 2048576, // 2MB
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567890',
    archive_download_url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567890/zip',
    expired: false,
    created_at: '2023-12-01T10:30:00Z',
    updated_at: '2023-12-01T10:35:00Z',
    expires_at: '2023-12-31T10:30:00Z',
    workflow_run: {
      id: 987654321,
      repository_id: 12345678,
      head_repository_id: 12345678,
      head_branch: 'main',
      head_sha: 'abc123def456'
    }
  },
  {
    id: 1234567891,
    node_id: 'MDg6QXJ0aWZhY3QxMjM0NTY3ODkx',
    name: 'surefire-reports',
    size_in_bytes: 5242880, // 5MB
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567891',
    archive_download_url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567891/zip',
    expired: false,
    created_at: '2023-12-01T10:30:30Z',
    updated_at: '2023-12-01T10:36:15Z',
    expires_at: '2023-12-31T10:30:30Z',
    workflow_run: {
      id: 987654321,
      repository_id: 12345678,
      head_repository_id: 12345678,
      head_branch: 'main',
      head_sha: 'abc123def456'
    }
  },
  {
    id: 1234567892,
    node_id: 'MDg6QXJ0aWZhY3QxMjM0NTY3ODky',
    name: 'gradle-test-results',
    size_in_bytes: 3145728, // 3MB
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567892',
    archive_download_url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567892/zip',
    expired: false,
    created_at: '2023-12-01T10:31:00Z',
    updated_at: '2023-12-01T10:37:45Z',
    expires_at: '2023-12-31T10:31:00Z',
    workflow_run: {
      id: 987654321,
      repository_id: 12345678,
      head_repository_id: 12345678,
      head_branch: 'main',
      head_sha: 'abc123def456'
    }
  },
  {
    id: 1234567893,
    node_id: 'MDg6QXJ0aWZhY3QxMjM0NTY3ODkz',
    name: 'jest-junit-results',
    size_in_bytes: 1048576, // 1MB
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567893',
    archive_download_url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567893/zip',
    expired: false,
    created_at: '2023-12-01T10:31:30Z',
    updated_at: '2023-12-01T10:38:20Z',
    expires_at: '2023-12-31T10:31:30Z',
    workflow_run: {
      id: 987654321,
      repository_id: 12345678,
      head_repository_id: 12345678,
      head_branch: 'main',
      head_sha: 'abc123def456'
    }
  },
  {
    id: 1234567894,
    node_id: 'MDg6QXJ0aWZhY3QxMjM0NTY3ODk0',
    name: 'coverage-report',
    size_in_bytes: 10485760, // 10MB - not a test artifact
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567894',
    archive_download_url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567894/zip',
    expired: false,
    created_at: '2023-12-01T10:32:00Z',
    updated_at: '2023-12-01T10:39:10Z',
    expires_at: '2023-12-31T10:32:00Z',
    workflow_run: {
      id: 987654321,
      repository_id: 12345678,
      head_repository_id: 12345678,
      head_branch: 'main',
      head_sha: 'abc123def456'
    }
  },
  {
    id: 1234567895,
    node_id: 'MDg6QXJ0aWZhY3QxMjM0NTY3ODk1',
    name: 'expired-test-results',
    size_in_bytes: 524288, // 512KB
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567895',
    archive_download_url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1234567895/zip',
    expired: true, // Expired artifact
    created_at: '2023-11-01T10:30:00Z',
    updated_at: '2023-11-01T10:35:00Z',
    expires_at: '2023-11-30T10:30:00Z',
    workflow_run: {
      id: 987654320,
      repository_id: 12345678,
      head_repository_id: 12345678,
      head_branch: 'main',
      head_sha: 'def456abc123'
    }
  }
];

// ============================================================================
// Mock Workflow Run Data
// ============================================================================

export const MOCK_WORKFLOW_RUN: MockWorkflowRun = {
  id: 987654321,
  name: 'CI Pipeline',
  node_id: 'WFR_kwLOABCDEFGHIJKLMNOP',
  head_branch: 'main',
  head_sha: 'abc123def456789012345678901234567890abcd',
  path: '.github/workflows/ci.yml',
  display_title: 'Add comprehensive test suite',
  run_number: 142,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  workflow_id: 12345678,
  check_suite_id: 87654321,
  check_suite_node_id: 'CS_kwLOABCDEFGHIJKLMNOP',
  url: 'https://api.github.com/repos/test-org/test-repo/actions/runs/987654321',
  html_url: 'https://github.com/test-org/test-repo/actions/runs/987654321',
  pull_requests: [],
  created_at: '2023-12-01T10:25:00Z',
  updated_at: '2023-12-01T10:45:00Z',
  actor: {
    login: 'test-developer',
    id: 1234567,
    node_id: 'U_kgDOABCDEFG',
    avatar_url: 'https://avatars.githubusercontent.com/u/1234567?v=4',
    gravatar_id: '',
    url: 'https://api.github.com/users/test-developer',
    html_url: 'https://github.com/test-developer',
    type: 'User',
    site_admin: false
  },
  run_attempt: 1,
  referenced_workflows: [],
  run_started_at: '2023-12-01T10:25:00Z',
  triggering_actor: {
    login: 'test-developer',
    id: 1234567,
    node_id: 'U_kgDOABCDEFG',
    avatar_url: 'https://avatars.githubusercontent.com/u/1234567?v=4',
    gravatar_id: '',
    url: 'https://api.github.com/users/test-developer',
    html_url: 'https://github.com/test-developer',
    type: 'User',
    site_admin: false
  },
  jobs_url: 'https://api.github.com/repos/test-org/test-repo/actions/runs/987654321/jobs',
  logs_url: 'https://api.github.com/repos/test-org/test-repo/actions/runs/987654321/logs',
  check_suite_url: 'https://api.github.com/repos/test-org/test-repo/check-suites/87654321',
  artifacts_url: 'https://api.github.com/repos/test-org/test-repo/actions/runs/987654321/artifacts',
  cancel_url: 'https://api.github.com/repos/test-org/test-repo/actions/runs/987654321/cancel',
  rerun_url: 'https://api.github.com/repos/test-org/test-repo/actions/runs/987654321/rerun',
  previous_attempt_url: null,
  workflow_url: 'https://api.github.com/repos/test-org/test-repo/actions/workflows/12345678',
  head_commit: {
    id: 'abc123def456789012345678901234567890abcd',
    tree_id: '321cba654fed987654321098765432109876543',
    message: 'Add comprehensive test suite for JUnit ingestion\n\nIncludes unit tests, integration tests, and performance tests',
    timestamp: '2023-12-01T10:20:00Z',
    author: {
      name: 'Test Developer',
      email: 'test.developer@example.com'
    },
    committer: {
      name: 'Test Developer',
      email: 'test.developer@example.com'
    }
  },
  repository: {
    id: 12345678,
    node_id: 'R_kgDOABCDEFG',
    name: 'test-repo',
    full_name: 'test-org/test-repo',
    private: false,
    owner: {
      login: 'test-org',
      id: 7654321,
      node_id: 'O_kgDOABCDEFG',
      avatar_url: 'https://avatars.githubusercontent.com/u/7654321?v=4',
      gravatar_id: '',
      url: 'https://api.github.com/orgs/test-org',
      html_url: 'https://github.com/test-org',
      type: 'Organization',
      site_admin: false
    },
    html_url: 'https://github.com/test-org/test-repo',
    description: 'A comprehensive test repository for FlakeGuard testing',
    fork: false,
    url: 'https://api.github.com/repos/test-org/test-repo'
  },
  head_repository: {
    id: 12345678,
    node_id: 'R_kgDOABCDEFG',
    name: 'test-repo',
    full_name: 'test-org/test-repo',
    private: false,
    owner: {
      login: 'test-org',
      id: 7654321,
      node_id: 'O_kgDOABCDEFG',
      avatar_url: 'https://avatars.githubusercontent.com/u/7654321?v=4',
      gravatar_id: '',
      url: 'https://api.github.com/orgs/test-org',
      html_url: 'https://github.com/test-org',
      type: 'Organization',
      site_admin: false
    },
    html_url: 'https://github.com/test-org/test-repo',
    description: 'A comprehensive test repository for FlakeGuard testing',
    fork: false,
    url: 'https://api.github.com/repos/test-org/test-repo'
  }
};

// ============================================================================
// Error Response Mocks
// ============================================================================

export const MOCK_NOT_FOUND_ERROR = {
  message: 'Not Found',
  documentation_url: 'https://docs.github.com/rest/reference/actions#get-a-workflow-run'
};

export const MOCK_UNAUTHORIZED_ERROR = {
  message: 'Bad credentials',
  documentation_url: 'https://docs.github.com/rest'
};

export const MOCK_FORBIDDEN_ERROR = {
  message: 'Resource not accessible by integration',
  documentation_url: 'https://docs.github.com/rest/reference/actions#get-a-workflow-run'
};

export const MOCK_RATE_LIMIT_ERROR: MockRateLimitResponse = {
  message: 'API rate limit exceeded for installation ID 123456.',
  documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting'
};

export const MOCK_SERVER_ERROR = {
  message: 'Server Error',
  documentation_url: 'https://docs.github.com/rest'
};

// ============================================================================
// Response Headers
// ============================================================================

export const MOCK_RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-ratelimit-limit': '15000',
  'x-ratelimit-remaining': '14999',
  'x-ratelimit-reset': '1701422400',
  'x-ratelimit-used': '1',
  'x-ratelimit-resource': 'core',
  'access-control-expose-headers': 'ETag, Link, Location, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource',
  'access-control-allow-origin': '*',
  'x-github-request-id': '1234:5678:9ABC:DEF0:123456789',
  'referrer-policy': 'origin-when-cross-origin, strict-origin-when-cross-origin',
  'content-security-policy': 'default-src \'none\'',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'deny',
  'x-xss-protection': '0',
  'vary': 'Accept-Encoding, Accept, X-Requested-With',
  'x-served-by': 'cache-sea12345-SEA',
  'x-cache': 'MISS',
  'x-cache-hits': '0',
  'x-timer': 'S1701420000.123456,VS0,VE89',
  'connection': 'close'
};

export const MOCK_RATE_LIMIT_HEADERS = {
  ...MOCK_RESPONSE_HEADERS,
  'x-ratelimit-limit': '15000',
  'x-ratelimit-remaining': '0',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
  'x-ratelimit-used': '15000',
  'retry-after': '3600',
  status: '403'
};

// ============================================================================
// Mock GitHub API Client
// ============================================================================

export class MockGitHubApiClient {
  private rateLimitExceeded = false;
  private requestCount = 0;
  private readonly maxRequests = 15000;

  constructor(private authToken?: string) {}

  async getWorkflowRun(_owner: string, _repo: string, runId: number): Promise<MockWorkflowRun> {
    this.checkRateLimit();
    this.incrementRequestCount();

    if (!this.authToken) {
      throw this.createError(401, MOCK_UNAUTHORIZED_ERROR);
    }

    if (runId === 999999999) {
      throw this.createError(404, MOCK_NOT_FOUND_ERROR);
    }

    if (runId === 987654321) {
      return MOCK_WORKFLOW_RUN;
    }

    // Return a modified version for other run IDs
    return {
      ...MOCK_WORKFLOW_RUN,
      id: runId,
      run_number: runId - 987654321 + 142,
      head_sha: `${runId}def456789012345678901234567890abcd`.slice(0, 40)
    };
  }

  async listWorkflowRunArtifacts(_owner: string, _repo: string, runId: number): Promise<{
    total_count: number;
    artifacts: MockArtifact[];
  }> {
    this.checkRateLimit();
    this.incrementRequestCount();

    if (!this.authToken) {
      throw this.createError(401, MOCK_UNAUTHORIZED_ERROR);
    }

    if (runId === 999999999) {
      throw this.createError(404, MOCK_NOT_FOUND_ERROR);
    }

    // Filter artifacts for the specific workflow run
    const artifacts = MOCK_ARTIFACTS.filter(artifact => 
      artifact.workflow_run?.id === runId || runId === 987654321
    );

    return {
      total_count: artifacts.length,
      artifacts
    };
  }

  async downloadArtifact(_owner: string, _repo: string, artifactId: number): Promise<Buffer> {
    this.checkRateLimit();
    this.incrementRequestCount();

    if (!this.authToken) {
      throw this.createError(401, MOCK_UNAUTHORIZED_ERROR);
    }

    const artifact = MOCK_ARTIFACTS.find(a => a.id === artifactId);
    if (!artifact) {
      throw this.createError(404, MOCK_NOT_FOUND_ERROR);
    }

    if (artifact.expired) {
      throw this.createError(410, { message: 'Artifact has expired' });
    }

    // Return mock ZIP content based on artifact name
    return this.generateMockZipContent(artifact.name);
  }

  async getArtifact(_owner: string, _repo: string, artifactId: number): Promise<MockArtifact> {
    this.checkRateLimit();
    this.incrementRequestCount();

    if (!this.authToken) {
      throw this.createError(401, MOCK_UNAUTHORIZED_ERROR);
    }

    const artifact = MOCK_ARTIFACTS.find(a => a.id === artifactId);
    if (!artifact) {
      throw this.createError(404, MOCK_NOT_FOUND_ERROR);
    }

    return artifact;
  }

  // Test utility methods

  simulateRateLimit(): void {
    this.rateLimitExceeded = true;
  }

  resetRateLimit(): void {
    this.rateLimitExceeded = false;
    this.requestCount = 0;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  getRemainingRequests(): number {
    return Math.max(0, this.maxRequests - this.requestCount);
  }

  private checkRateLimit(): void {
    if (this.rateLimitExceeded || this.requestCount >= this.maxRequests) {
      throw this.createError(403, MOCK_RATE_LIMIT_ERROR, MOCK_RATE_LIMIT_HEADERS);
    }
  }

  private incrementRequestCount(): void {
    this.requestCount++;
  }

  private createError(status: number, body: any, headers: Record<string, string> = MOCK_RESPONSE_HEADERS): Error {
    const error = new Error(body.message) as any;
    error.status = status;
    error.response = {
      status,
      data: body,
      headers
    };
    return error;
  }

  private generateMockZipContent(artifactName: string): Buffer {
    // Generate different mock content based on artifact name
    const content = this.getMockXmlContent(artifactName);
    
    // In a real implementation, this would create an actual ZIP archive
    // For testing purposes, we'll return the XML content directly
    return Buffer.from(content, 'utf-8');
  }

  private getMockXmlContent(artifactName: string): string {
    switch (artifactName) {
      case 'test-results':
      case 'surefire-reports':
        return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="TestSuite" tests="10" failures="2" errors="1" skipped="1" time="5.234">
  <testcase name="test1" classname="TestClass" time="0.123"/>
  <testcase name="test2" classname="TestClass" time="0.456">
    <failure message="Assertion failed">Test failure details</failure>
  </testcase>
  <testcase name="test3" classname="TestClass" time="0.789">
    <error message="Runtime error">Test error details</error>
  </testcase>
  <testcase name="test4" classname="TestClass" time="0.012">
    <skipped message="Test skipped"/>
  </testcase>
</testsuite>`;

      case 'gradle-test-results':
        return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="GradleTestSuite" tests="5" failures="1" errors="0" skipped="0" time="3.456">
  <testcase name="gradleTest1" classname="GradleTestClass" time="0.567"/>
  <testcase name="gradleTest2" classname="GradleTestClass" time="0.890">
    <failure message="Gradle test failed">Gradle failure details</failure>
  </testcase>
</testsuite>`;

      case 'jest-junit-results':
        return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="8" failures="1" errors="0" time="2.345">
  <testsuite name="JestTestSuite" tests="8" failures="1" errors="0" skipped="0" time="2.345">
    <testcase classname="JestTestClass" name="jestTest1" time="0.123"/>
    <testcase classname="JestTestClass" name="jestTest2" time="0.234">
      <failure message="Jest assertion failed">Jest failure details</failure>
    </testcase>
  </testsuite>
</testsuites>`;

      default:
        return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="DefaultTestSuite" tests="1" failures="0" errors="0" skipped="0" time="0.001">
  <testcase name="defaultTest" classname="DefaultTestClass" time="0.001"/>
</testsuite>`;
    }
  }
}

// ============================================================================
// Mock Factory Functions
// ============================================================================

export function createMockGitHubApiClient(authToken = 'mock-token'): MockGitHubApiClient {
  return new MockGitHubApiClient(authToken);
}

export function createMockArtifact(overrides: Partial<MockArtifact> = {}): MockArtifact {
  const base = MOCK_ARTIFACTS[0];
  const result = { ...base } as MockArtifact;
  
  // Apply overrides only if they have defined values
  Object.entries(overrides).forEach(([key, value]) => {
    if (value !== undefined) {
      (result as any)[key] = value;
    }
  });
  
  return result;
}

export function createMockWorkflowRun(overrides: Partial<MockWorkflowRun> = {}): MockWorkflowRun {
  return {
    ...MOCK_WORKFLOW_RUN,
    ...overrides
  };
}

// ============================================================================
// Vitest Mock Utilities
// ============================================================================

export function setupGitHubApiMocks() {
  const mockClient = createMockGitHubApiClient();
  
  return {
    client: mockClient,
    mocks: {
      getWorkflowRun: vi.fn().mockImplementation(mockClient.getWorkflowRun.bind(mockClient)),
      listWorkflowRunArtifacts: vi.fn().mockImplementation(mockClient.listWorkflowRunArtifacts.bind(mockClient)),
      downloadArtifact: vi.fn().mockImplementation(mockClient.downloadArtifact.bind(mockClient)),
      getArtifact: vi.fn().mockImplementation(mockClient.getArtifact.bind(mockClient))
    }
  };
}

export function simulateNetworkError(delay = 1000): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Network request failed'));
    }, delay);
  });
}

export function simulateTimeout(delay = 5000): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error('Request timeout') as any;
      error.code = 'ETIMEDOUT';
      reject(error);
    }, delay);
  });
}

export function createLargeArtifactResponse(sizeInMB: number): MockArtifact {
  return createMockArtifact({
    id: 9999999999,
    name: `large-test-results-${sizeInMB}mb`,
    size_in_bytes: sizeInMB * 1024 * 1024,
    url: `https://api.github.com/repos/test-org/test-repo/actions/artifacts/9999999999`,
    archive_download_url: `https://api.github.com/repos/test-org/test-repo/actions/artifacts/9999999999/zip`
  });
}

// ============================================================================
// Test Data Scenarios
// ============================================================================

export const TEST_SCENARIOS = {
  SUCCESSFUL_INGESTION: {
    workflowRun: MOCK_WORKFLOW_RUN,
    artifacts: MOCK_ARTIFACTS.slice(0, 4), // First 4 artifacts
    expectedTests: 23,
    expectedFailures: 4,
    expectedErrors: 1
  },
  
  NO_ARTIFACTS: {
    workflowRun: createMockWorkflowRun({ id: 111111111 }),
    artifacts: [],
    expectedTests: 0,
    expectedFailures: 0,
    expectedErrors: 0
  },
  
  EXPIRED_ARTIFACTS: {
    workflowRun: createMockWorkflowRun({ id: 222222222 }),
    artifacts: [MOCK_ARTIFACTS[5]], // Expired artifact
    expectedTests: 0,
    expectedFailures: 0,
    expectedErrors: 0
  },
  
  LARGE_ARTIFACTS: {
    workflowRun: createMockWorkflowRun({ id: 333333333 }),
    artifacts: [createLargeArtifactResponse(150)], // 150MB artifact
    expectedError: 'FILE_TOO_LARGE'
  },
  
  RATE_LIMITED: {
    workflowRun: createMockWorkflowRun({ id: 444444444 }),
    artifacts: MOCK_ARTIFACTS.slice(0, 2),
    rateLimitError: MOCK_RATE_LIMIT_ERROR
  },
  
  UNAUTHORIZED_ACCESS: {
    workflowRun: null,
    artifacts: [],
    authError: MOCK_UNAUTHORIZED_ERROR
  },
  
  WORKFLOW_NOT_FOUND: {
    workflowRun: null,
    artifacts: [],
    notFoundError: MOCK_NOT_FOUND_ERROR
  }
} as const;