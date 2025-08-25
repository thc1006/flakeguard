/**
 * E2E Tests for GitHub Webhook Processing
 * 
 * Tests complete webhook flow from GitHub to database updates
 */

import crypto from 'crypto';

import { test, expect, type APIRequestContext } from '@playwright/test';

// GitHub webhook fixtures
import checkRunCompleted from '../../fixtures/github/check-run-completed.json';
import checkRunRequestedAction from '../../fixtures/github/check-run-requested-action.json';
import workflowRunCompleted from '../../fixtures/github/workflow-run-completed.json';

const API_BASE_URL = 'http://localhost:3001';
const WEBHOOK_SECRET = 'test-webhook-secret-12345';

test.describe('GitHub Webhook Processing', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext({
      baseURL: API_BASE_URL,
    });
  });

  test.afterAll(async () => {
    await request.dispose();
  });

  // Helper function to create GitHub webhook signature
  function createWebhookSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }

  test('should process workflow_run completed webhook', async () => {
    const payload = JSON.stringify(workflowRunCompleted);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    // Send webhook
    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response.status()).toBe(200);

    // Verify response
    const responseData = await response.json();
    expect(responseData).toEqual({
      success: true,
      message: 'Webhook processed successfully',
    });

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify workflow run was stored in database
    const workflowRunResponse = await request.get(`/api/workflow-runs/${workflowRunCompleted.workflow_run.id}`);
    expect(workflowRunResponse.status()).toBe(200);

    const workflowRun = await workflowRunResponse.json();
    expect(workflowRun).toMatchObject({
      externalId: workflowRunCompleted.workflow_run.id.toString(),
      name: workflowRunCompleted.workflow_run.name,
      status: workflowRunCompleted.workflow_run.status,
      conclusion: workflowRunCompleted.workflow_run.conclusion,
      runNumber: workflowRunCompleted.workflow_run.run_number,
    });

    // Verify repository was created/updated
    const repositoryResponse = await request.get(`/api/repositories/${workflowRunCompleted.repository.full_name}`);
    expect(repositoryResponse.status()).toBe(200);

    const repository = await repositoryResponse.json();
    expect(repository).toMatchObject({
      fullName: workflowRunCompleted.repository.full_name,
      name: workflowRunCompleted.repository.name,
      owner: workflowRunCompleted.repository.owner.login,
      installationId: workflowRunCompleted.installation?.id,
    });
  });

  test('should process check_run completed webhook with flake detection', async () => {
    const payload = JSON.stringify(checkRunCompleted);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    // Send webhook
    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'check_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response.status()).toBe(200);

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify check run was stored
    const checkRunResponse = await request.get(`/api/check-runs/${checkRunCompleted.check_run.id}`);
    expect(checkRunResponse.status()).toBe(200);

    const checkRun = await checkRunResponse.json();
    expect(checkRun).toMatchObject({
      externalId: checkRunCompleted.check_run.id.toString(),
      name: checkRunCompleted.check_run.name,
      status: checkRunCompleted.check_run.status,
      conclusion: checkRunCompleted.check_run.conclusion,
    });

    // Verify flake analysis was triggered (check for ingestion jobs)
    const jobsResponse = await request.get('/api/internal/jobs/ingestion');
    expect(jobsResponse.status()).toBe(200);

    const jobs = await jobsResponse.json();
    expect(jobs.length).toBeGreaterThan(0);
    
    // Verify at least one job is for our repository
    const relevantJobs = jobs.filter((job: any) => 
      job.data?.repositoryFullName === checkRunCompleted.repository.full_name
    );
    expect(relevantJobs.length).toBeGreaterThan(0);
  });

  test('should handle check_run requested_action webhook', async () => {
    const payload = JSON.stringify(checkRunRequestedAction);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    // Send webhook
    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'check_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response.status()).toBe(200);

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify action was processed (check for quarantine actions)
    if (checkRunRequestedAction.requested_action?.identifier === 'quarantine_flaky_tests') {
      const quarantineResponse = await request.get(`/api/quarantine?repository=${checkRunRequestedAction.repository.full_name}`);
      expect(quarantineResponse.status()).toBe(200);

      // Verify quarantine actions were created or updated
      const quarantineData = await quarantineResponse.json();
      expect(Array.isArray(quarantineData)).toBe(true);
    }
  });

  test('should reject webhook with invalid signature', async () => {
    const payload = JSON.stringify(workflowRunCompleted);
    const invalidSignature = 'sha256=invalid_signature_hash';

    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': invalidSignature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response.status()).toBe(401);

    const errorData = await response.json();
    expect(errorData).toMatchObject({
      error: 'Invalid webhook signature',
    });
  });

  test('should reject webhook with missing signature', async () => {
    const payload = JSON.stringify(workflowRunCompleted);

    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'User-Agent': 'GitHub-Hookshot/12345',
        // Missing X-Hub-Signature-256 header
      },
      data: payload,
    });

    expect(response.status()).toBe(401);
  });

  test('should handle malformed webhook payload gracefully', async () => {
    const malformedPayload = '{"invalid": "json", "missing": "required_fields"}';
    const signature = createWebhookSignature(malformedPayload, WEBHOOK_SECRET);

    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: malformedPayload,
    });

    // Should accept the webhook but handle gracefully
    expect(response.status()).toBe(200);

    const responseData = await response.json();
    expect(responseData).toEqual({
      success: true,
      message: 'Webhook received but could not be processed',
    });
  });

  test('should handle duplicate webhooks idempotently', async () => {
    const payload = JSON.stringify(workflowRunCompleted);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);
    const deliveryId = crypto.randomUUID();

    // Send same webhook twice
    const response1 = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': deliveryId,
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    const response2 = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': deliveryId, // Same delivery ID
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response1.status()).toBe(200);
    expect(response2.status()).toBe(200);

    // Both should succeed, but second should be detected as duplicate
    const responseData2 = await response2.json();
    expect(responseData2.message).toContain('already processed');
  });

  test('should process workflow run with test artifacts and generate flake analysis', async () => {
    // Modify the workflow run to have failure conclusion to trigger artifact processing
    const failedWorkflowRun = {
      ...workflowRunCompleted,
      workflow_run: {
        ...workflowRunCompleted.workflow_run,
        conclusion: 'failure',
        id: 6789012399, // Different ID to avoid conflicts
      }
    };

    const payload = JSON.stringify(failedWorkflowRun);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    // Send webhook
    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'workflow_run',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response.status()).toBe(200);

    // Wait for async processing including artifact download and analysis
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if flake analysis was generated
    const analysisResponse = await request.get(
      `/api/repositories/${failedWorkflowRun.repository.full_name}/flake-analysis`
    );
    expect(analysisResponse.status()).toBe(200);

    const analysis = await analysisResponse.json();
    expect(analysis).toBeDefined();
    expect(Array.isArray(analysis.flakyTests)).toBe(true);
  });

  test('should validate webhook event types', async () => {
    const payload = JSON.stringify(workflowRunCompleted);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    // Test unsupported event type
    const response = await request.post('/webhooks/github', {
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'unsupported_event',
        'X-GitHub-Delivery': crypto.randomUUID(),
        'X-Hub-Signature-256': signature,
        'User-Agent': 'GitHub-Hookshot/12345',
      },
      data: payload,
    });

    expect(response.status()).toBe(200);

    const responseData = await response.json();
    expect(responseData.message).toContain('Event type not supported');
  });

  test('should handle rate limiting gracefully', async () => {
    const payload = JSON.stringify(workflowRunCompleted);
    const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

    // Send multiple webhooks rapidly to trigger rate limiting
    const promises = Array.from({ length: 20 }, (_, i) => 
      request.post('/webhooks/github', {
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'workflow_run',
          'X-GitHub-Delivery': crypto.randomUUID(),
          'X-Hub-Signature-256': signature,
          'User-Agent': 'GitHub-Hookshot/12345',
        },
        data: JSON.stringify({
          ...workflowRunCompleted,
          workflow_run: {
            ...workflowRunCompleted.workflow_run,
            id: workflowRunCompleted.workflow_run.id + i,
          }
        }),
      })
    );

    const responses = await Promise.all(promises);

    // Most should succeed, but some might be rate limited
    const successCount = responses.filter(r => r.status() === 200).length;
    const rateLimitedCount = responses.filter(r => r.status() === 429).length;

    expect(successCount).toBeGreaterThan(10); // Most should succeed
    expect(successCount + rateLimitedCount).toBe(20); // All should be either success or rate limited
  });
});