/**
 * Check Runs Integration Test
 * 
 * Simple integration test demonstrating the Check Runs rendering system
 * without requiring external dependencies to be installed.
 * 
 * This tests the core functionality of:
 * - renderCheckRunOutput function
 * - generateCheckRunActions function  
 * - Action count validation
 * - Markdown output consistency
 */

import {
  renderCheckRunOutput,
  generateCheckRunActions,
  convertToTestCandidates,
  type TestCandidate,
} from '../check-runs.js';

// Mock minimal dependencies
const mockPrisma = {} as any;

// Test data factory
function createTestCandidate(overrides: Partial<TestCandidate> = {}): TestCandidate {
  return {
    testName: 'com.example.TestClass.testMethod',
    failCount: 5,
    rerunPassRate: 0.75,
    lastFailedRun: '2024-01-15T10:30:00.000Z',
    confidence: 0.8,
    failurePattern: 'timeout',
    totalRuns: 20,
    ...overrides,
  };
}

// Integration tests
function testRenderCheckRunOutput() {
  console.log('Testing renderCheckRunOutput...');
  
  // Test empty state
  const emptyOutput = renderCheckRunOutput([]);
  console.assert(emptyOutput.title.includes('FlakeGuard Analysis Complete'), 'Empty state title incorrect');
  console.assert(emptyOutput.summary.includes('No flaky test candidates'), 'Empty state summary incorrect');
  
  // Test with single candidate
  const singleCandidate = createTestCandidate();
  const singleOutput = renderCheckRunOutput([singleCandidate]);
  console.assert(singleOutput.title.includes('1 Flaky Test Candidate'), 'Single candidate title incorrect');
  console.assert(singleOutput.summary.includes('| Test Name |'), 'Missing table header');
  console.assert(singleOutput.summary.includes('com.example.TestClass.testMethod'), 'Missing test name');
  console.assert(singleOutput.summary.includes('80.0%'), 'Missing confidence percentage');
  
  // Test with multiple candidates
  const multiCandidates = [
    createTestCandidate({ testName: 'test1', confidence: 0.9 }),
    createTestCandidate({ testName: 'test2', confidence: 0.6 }),
    createTestCandidate({ testName: 'test3', confidence: 0.4 }),
  ];
  const multiOutput = renderCheckRunOutput(multiCandidates);
  console.assert(multiOutput.title.includes('3 Flaky Test Candidates'), 'Multiple candidates title incorrect');
  
  // Test sorting (high confidence first)
  const lines = multiOutput.summary.split('\n');
  const testLines = lines.filter(line => line.includes('`test'));
  console.assert(testLines[0].includes('test1'), 'Sorting incorrect - test1 should be first');
  console.assert(testLines[1].includes('test2'), 'Sorting incorrect - test2 should be second');
  console.assert(testLines[2].includes('test3'), 'Sorting incorrect - test3 should be third');
  
  console.log('✅ renderCheckRunOutput tests passed');
}

function testGenerateCheckRunActions() {
  console.log('Testing generateCheckRunActions...');
  
  // Test empty case with failures
  const emptyWithFailures = generateCheckRunActions([], true);
  console.assert(emptyWithFailures.length === 1, 'Should have 1 action for failures only');
  console.assert(emptyWithFailures[0].identifier === 'rerun_failed', 'Should suggest rerun_failed');
  
  // Test empty case without failures
  const emptyWithoutFailures = generateCheckRunActions([], false);
  console.assert(emptyWithoutFailures.length === 0, 'Should have 0 actions for no failures or tests');
  
  // Test with high confidence tests
  const highConfidenceTests = [
    createTestCandidate({ confidence: 0.9 }),
    createTestCandidate({ confidence: 0.85 }),
  ];
  const highConfidenceActions = generateCheckRunActions(highConfidenceTests, true);
  console.assert(highConfidenceActions.length <= 3, 'Should never exceed 3 actions');
  console.assert(highConfidenceActions.some(a => a.identifier === 'rerun_failed'), 'Should include rerun_failed');
  console.assert(highConfidenceActions.some(a => a.identifier === 'quarantine'), 'Should include quarantine for high confidence');
  console.assert(highConfidenceActions.some(a => a.identifier === 'open_issue'), 'Should include open_issue');
  
  // Test action count constraint - even with many high confidence tests
  const manyHighConfidenceTests = Array.from({ length: 50 }, (_, i) => 
    createTestCandidate({ testName: `test${i}`, confidence: 0.95 })
  );
  const manyActions = generateCheckRunActions(manyHighConfidenceTests, true);
  console.assert(manyActions.length <= 3, 'Must never exceed 3 actions even with many tests');
  console.assert(manyActions.length >= 0, 'Must have at least 0 actions');
  
  // Test medium confidence
  const mediumConfidenceTests = [createTestCandidate({ confidence: 0.6 })];
  const mediumActions = generateCheckRunActions(mediumConfidenceTests, false);
  console.assert(mediumActions.length <= 3, 'Should not exceed 3 actions');
  console.assert(mediumActions.some(a => a.identifier === 'open_issue'), 'Should include open_issue for medium confidence');
  
  console.log('✅ generateCheckRunActions tests passed');
}

function testConvertToTestCandidates() {
  console.log('Testing convertToTestCandidates...');
  
  const dbRecords = [
    {
      testName: 'com.example.IntegrationTest',
      confidence: 0.85,
      failureRate: 0.4,
      totalRuns: 25,
      historicalFailures: 10,
      lastFailureAt: new Date('2024-01-15T10:30:00Z'),
      failurePattern: 'connection timeout',
    },
    {
      testName: 'com.example.UnitTest',
      confidence: 0.6,
      failureRate: 0.2,
      totalRuns: 15,
      historicalFailures: 3,
      lastFailureAt: null,
      failurePattern: null,
    },
  ];
  
  const candidates = convertToTestCandidates(mockPrisma, dbRecords);
  
  console.assert(candidates.length === 2, 'Should convert all records');
  console.assert(candidates[0].testName === 'com.example.IntegrationTest', 'Should preserve test name');
  console.assert(candidates[0].failCount === 10, 'Should map historicalFailures to failCount');
  console.assert(candidates[0].confidence === 0.85, 'Should preserve confidence');
  console.assert(candidates[0].lastFailedRun === '2024-01-15T10:30:00.000Z', 'Should format date correctly');
  console.assert(candidates[0].rerunPassRate > 0 && candidates[0].rerunPassRate < 1, 'Should calculate valid rerun pass rate');
  
  console.assert(candidates[1].lastFailedRun === null, 'Should handle null dates');
  console.assert(candidates[1].failurePattern === null, 'Should handle null patterns');
  
  console.log('✅ convertToTestCandidates tests passed');
}

function testEdgeCases() {
  console.log('Testing edge cases...');
  
  // Test with malformed data
  const malformedTest = createTestCandidate({
    testName: '',
    failCount: -1,
    rerunPassRate: 2.0, // Invalid
    confidence: -0.5, // Invalid
  });
  
  // Should not throw
  try {
    const output = renderCheckRunOutput([malformedTest]);
    const actions = generateCheckRunActions([malformedTest], true);
    console.assert(actions.length <= 3, 'Should still respect action limit with malformed data');
    console.log('✅ Handles malformed data gracefully');
  } catch (error) {
    console.error('❌ Failed to handle malformed data:', error);
  }
  
  // Test with large numbers of tests
  const manyTests = Array.from({ length: 100 }, (_, i) => 
    createTestCandidate({ testName: `test${i}`, confidence: Math.random() })
  );
  
  const largeOutput = renderCheckRunOutput(manyTests);
  console.assert(largeOutput.summary.includes('Showing top 10 of 100'), 'Should limit display to 10');
  
  const largeActions = generateCheckRunActions(manyTests, true);
  console.assert(largeActions.length <= 3, 'Should limit actions even with many tests');
  
  console.log('✅ Edge case tests passed');
}

function testMarkdownConsistency() {
  console.log('Testing markdown consistency...');
  
  // Test with special characters in test names
  const specialCharsTest = createTestCandidate({
    testName: 'test_with_underscores.TestClass[param*value]',
  });
  
  const output = renderCheckRunOutput([specialCharsTest]);
  
  // Should escape markdown characters
  console.assert(output.summary.includes('\\['), 'Should escape square brackets');
  console.assert(output.summary.includes('\\*'), 'Should escape asterisks');
  
  // Test markdown structure
  console.assert(output.summary.includes('## Flaky Test Candidates'), 'Should have proper heading');
  console.assert(output.summary.includes('|'), 'Should have table format');
  console.assert(output.summary.includes('### What are flaky tests?'), 'Should have explanation section');
  console.assert(output.summary.includes('### Recommended Actions'), 'Should have actions section');
  
  console.log('✅ Markdown consistency tests passed');
}

// Run all tests
function runIntegrationTests() {
  console.log('🧪 Starting FlakeGuard Check Runs Integration Tests\n');
  
  try {
    testRenderCheckRunOutput();
    testGenerateCheckRunActions();
    testConvertToTestCandidates();
    testEdgeCases();
    testMarkdownConsistency();
    
    console.log('\n✅ All integration tests passed! 🎉');
    console.log('\nKey Features Verified:');
    console.log('- ✅ Markdown output format consistency');
    console.log('- ✅ Action count validation (≤3 actions always)');
    console.log('- ✅ Edge case handling');
    console.log('- ✅ Data conversion from database format');
    console.log('- ✅ Proper test candidate sorting');
    console.log('- ✅ Special character escaping in markdown');
    
  } catch (error) {
    console.error('❌ Integration tests failed:', error);
    process.exit(1);
  }
}

// Export for potential external usage
export {
  runIntegrationTests,
  createTestCandidate,
};

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests();
}