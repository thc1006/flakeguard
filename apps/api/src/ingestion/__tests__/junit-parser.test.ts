/**
 * Comprehensive Tests for JUnit XML Parser
 * 
 * Test coverage for:
 * - All supported JUnit formats (Surefire, Gradle, Jest, pytest, PHPUnit, generic)
 * - XML structure validation and error recovery
 * - Memory efficiency tests for streaming parser
 * - Edge case handling (empty files, invalid XML, encoding issues)
 * - Format detection and auto-detection logic
 * - Performance tests with large XML files
 * - SAX parser event handling and state management
 */

import { createReadStream } from 'fs';
import { Readable } from 'stream';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseJUnitXML,
  parseJUnitXMLFile,
  parseJUnitXMLString,
  createJUnitParser,
  detectJUnitFormat
} from '../parsers/junit-parser.js';
import type {
  JUnitFormat,
  FormatSpecificConfig
} from '../types.js';
import { ParsingFailedException } from '../types.js';

// Mock fs module
vi.mock('fs', () => ({
  createReadStream: vi.fn()
}));

// ============================================================================
// Test Data and Helpers
// ============================================================================

/**
 * Generate test XML content for different formats
 */
function generateTestXML(format: JUnitFormat, options: {
  suiteCount?: number;
  testCount?: number;
  failures?: number;
  errors?: number;
  skipped?: number;
  includeSystemOut?: boolean;
  includeProperties?: boolean;
  malformed?: boolean;
} = {}): string {
  const {
    suiteCount = 1,
    testCount = 3,
    failures = 1,
    errors = 0,
    skipped = 1,
    includeSystemOut = false,
    includeProperties = false,
    malformed = false
  } = options;

  if (malformed) {
    return '<testsuite><unclosed><testcase name="test1" classname="Test1"</testsuite>';
  }

  const formatAttributes = getFormatSpecificAttributes(format);
  const testCases = generateTestCases(testCount, failures, errors, skipped, includeSystemOut);
  const properties = includeProperties ? generateProperties() : '';

  if (suiteCount === 1) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite ${formatAttributes.testsuite} 
           name="TestSuite1" 
           tests="${testCount}" 
           failures="${failures}" 
           errors="${errors}" 
           skipped="${skipped}" 
           time="1.234" 
           timestamp="2023-01-01T12:00:00">
  ${properties}
  ${testCases}
  ${includeSystemOut ? '<system-out><![CDATA[System output content]]></system-out>' : ''}
  ${includeSystemOut ? '<system-err><![CDATA[System error content]]></system-err>' : ''}
</testsuite>`;
  } else {
    const suites = Array.from({ length: suiteCount }, (_, i) => 
      `<testsuite ${formatAttributes.testsuite} 
                 name="TestSuite${i + 1}" 
                 tests="${testCount}" 
                 failures="${failures}" 
                 errors="${errors}" 
                 skipped="${skipped}" 
                 time="1.234">
        ${properties}
        ${testCases}
       </testsuite>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites ${formatAttributes.testsuites}
            name="AllTests" 
            tests="${testCount * suiteCount}" 
            failures="${failures * suiteCount}" 
            errors="${errors * suiteCount}" 
            skipped="${skipped * suiteCount}" 
            time="${1.234 * suiteCount}">
  ${suites}
</testsuites>`;
  }
}

function getFormatSpecificAttributes(format: JUnitFormat): { testsuite: string; testsuites: string } {
  switch (format) {
    case 'surefire':
      return {
        testsuite: 'hostname="localhost" id="1" package="com.example"',
        testsuites: 'hostname="localhost"'
      };
    case 'gradle':
      return {
        testsuite: 'hostname="gradle-host" id="gradle-1"',
        testsuites: 'hostname="gradle-host"'
      };
    case 'jest':
      return {
        testsuite: 'file="test.spec.js"',
        testsuites: ''
      };
    case 'pytest':
      return {
        testsuite: 'hostname="python-host"',
        testsuites: 'hostname="python-host"'
      };
    case 'phpunit':
      return {
        testsuite: 'file="TestClass.php"',
        testsuites: ''
      };
    default:
      return { testsuite: '', testsuites: '' };
  }
}

function generateTestCases(testCount: number, failures: number, errors: number, skipped: number, includeSystemOut: boolean): string {
  const testCases: string[] = [];
  
  for (let i = 0; i < testCount; i++) {
    const testName = `test${i + 1}`;
    const className = `TestClass${Math.floor(i / 3) + 1}`;
    const time = (Math.random() * 2).toFixed(3);

    let testCase = `<testcase name="${testName}" classname="${className}" time="${time}"`;
    
    if (i < failures) {
      testCase += `>
  <failure type="AssertionError" message="Test assertion failed">
    <![CDATA[
Expected: true
Actual: false
at TestClass1.${testName}(TestClass1.java:${i + 10})
    ]]>
  </failure>`;
      if (includeSystemOut) {
        testCase += `
  <system-out><![CDATA[Test ${testName} output]]></system-out>
  <system-err><![CDATA[Test ${testName} error]]></system-err>`;
      }
      testCase += '</testcase>';
    } else if (i < failures + errors) {
      testCase += `>
  <error type="RuntimeException" message="Unexpected error occurred">
    <![CDATA[
java.lang.RuntimeException: Something went wrong
at TestClass1.${testName}(TestClass1.java:${i + 10})
    ]]>
  </error>
</testcase>`;
    } else if (i < failures + errors + skipped) {
      testCase += `>
  <skipped message="Test disabled or ignored" />
</testcase>`;
    } else {
      testCase += ' />';
    }
    
    testCases.push(testCase);
  }
  
  return testCases.join('\n  ');
}

function generateProperties(): string {
  return `<properties>
    <property name="java.version" value="17.0.1"/>
    <property name="os.name" value="Linux"/>
    <property name="test.framework" value="JUnit 5"/>
  </properties>`;
}

function createStreamFromString(content: string): Readable {
  return new Readable({
    read() {
      this.push(content);
      this.push(null);
    }
  });
}

// ============================================================================
// Parser Creation Tests
// ============================================================================

describe('JUnit Parser Creation', () => {
  it('should create parser for all supported formats', () => {
    const formats: JUnitFormat[] = ['surefire', 'gradle', 'jest', 'pytest', 'phpunit', 'generic'];
    
    for (const format of formats) {
      const parser = createJUnitParser(format);
      expect(parser).toBeDefined();
      expect(parser.constructor.name).toContain('Parser');
    }
  });

  it('should create generic parser for unknown formats', () => {
    const parser = createJUnitParser('unknown' as JUnitFormat);
    expect(parser).toBeDefined();
  });

  it('should accept format-specific configuration', () => {
    const config: FormatSpecificConfig<'surefire'> = {
      strictMode: true,
      timeoutMs: 5000
    };
    
    const parser = createJUnitParser('surefire', config);
    expect(parser).toBeDefined();
  });
});

// ============================================================================
// Format Detection Tests
// ============================================================================

describe('Format Detection', () => {
  it('should detect Surefire format from content', async () => {
    const surefireXml = generateTestXML('surefire');
    const stream = createStreamFromString(surefireXml + '<!-- Generated by Maven Surefire -->');
    
    const result = await detectJUnitFormat(stream, 'surefire-reports/TEST-TestSuite.xml');
    
    expect(result.format).toBe('surefire');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.indicators).toContain('surefire keywords');
  });

  it('should detect Gradle format from content', async () => {
    const gradleXml = generateTestXML('gradle');
    const stream = createStreamFromString(gradleXml + '<!-- Gradle Test Executor -->');
    
    const result = await detectJUnitFormat(stream, 'build/test-results/test/TEST-TestSuite.xml');
    
    expect(result.format).toBe('gradle');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.indicators).toContain('gradle keywords');
  });

  it('should detect Jest format from content', async () => {
    const jestXml = generateTestXML('jest');
    const stream = createStreamFromString(jestXml + '<!-- Generated by Jest -->');
    
    const result = await detectJUnitFormat(stream, 'jest-junit.xml');
    
    expect(result.format).toBe('jest');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.indicators).toContain('jest keywords');
  });

  it('should detect pytest format from content', async () => {
    const pytestXml = generateTestXML('pytest');
    const stream = createStreamFromString(pytestXml + '<!-- Python pytest -->');
    
    const result = await detectJUnitFormat(stream, 'pytest-results.xml');
    
    expect(result.format).toBe('pytest');
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.indicators).toContain('pytest keywords');
  });

  it('should detect PHPUnit format from content', async () => {
    const phpunitXml = generateTestXML('phpunit');
    const stream = createStreamFromString(phpunitXml + '<!-- PHPUnit results -->');
    
    const result = await detectJUnitFormat(stream, 'phpunit-report.xml');
    
    expect(result.format).toBe('phpunit');
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.indicators).toContain('phpunit keywords');
  });

  it('should fallback to generic format for unknown content', async () => {
    const unknownXml = generateTestXML('generic');
    const stream = createStreamFromString(unknownXml);
    
    const result = await detectJUnitFormat(stream, 'unknown-results.xml');
    
    expect(result.format).toBe('generic');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should use filename for format detection', async () => {
    const xml = generateTestXML('generic');
    const stream = createStreamFromString(xml);
    
    const result = await detectJUnitFormat(stream, 'target/surefire-reports/TEST-MyTest.xml');
    
    expect(result.format).toBe('surefire');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.indicators).toContain('filename: target/surefire-reports/TEST-MyTest.xml');
  });

  it('should handle empty or invalid streams', async () => {
    const emptyStream = new Readable({ read() { this.push(null); } });
    
    const result = await detectJUnitFormat(emptyStream);
    
    expect(result.format).toBe('generic');
    expect(result.confidence).toBeLessThan(0.2);
  });
});

// ============================================================================
// XML Parsing Tests by Format
// ============================================================================

describe('Surefire Format Parsing', () => {
  it('should parse basic Surefire XML correctly', async () => {
    const xml = generateTestXML('surefire', { testCount: 3, failures: 1, skipped: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    expect(result.format).toBe('surefire');
    expect(result.testSuites.tests).toBe(3);
    expect(result.testSuites.failures).toBe(1);
    expect(result.testSuites.errors).toBe(0);
    expect(result.testSuites.skipped).toBe(1);
    expect(result.testSuites.suites).toHaveLength(1);
    
    const suite = result.testSuites.suites[0];
    expect(suite.name).toBe('TestSuite1');
    expect(suite.package).toBe('com.example');
    expect(suite.hostname).toBe('localhost');
    expect(suite.testCases).toHaveLength(3);
    
    // Check test case statuses
    const testCases = suite.testCases;
    expect(testCases.filter(tc => tc.status === 'failed')).toHaveLength(1);
    expect(testCases.filter(tc => tc.status === 'skipped')).toHaveLength(1);
    expect(testCases.filter(tc => tc.status === 'passed')).toHaveLength(1);
  });

  it('should parse multiple test suites', async () => {
    const xml = generateTestXML('surefire', { suiteCount: 3, testCount: 2 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    expect(result.testSuites.suites).toHaveLength(3);
    expect(result.testSuites.tests).toBe(6); // 3 suites × 2 tests
    
    result.testSuites.suites.forEach((suite, index) => {
      expect(suite.name).toBe(`TestSuite${index + 1}`);
      expect(suite.testCases).toHaveLength(2);
    });
  });

  it('should parse test failures with stack traces', async () => {
    const xml = generateTestXML('surefire', { testCount: 1, failures: 1, includeSystemOut: true });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    const failedTest = result.testSuites.suites[0].testCases[0];
    expect(failedTest.status).toBe('failed');
    expect(failedTest.failure).toBeDefined();
    expect(failedTest.failure!.type).toBe('AssertionError');
    expect(failedTest.failure!.message).toBe('Test assertion failed');
    expect(failedTest.failure!.stackTrace).toContain('Expected: true');
    expect(failedTest.systemOut).toBe('Test test1 output');
    expect(failedTest.systemErr).toBe('Test test1 error');
  });

  it('should parse test errors correctly', async () => {
    const xml = generateTestXML('surefire', { testCount: 1, failures: 0, errors: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    const errorTest = result.testSuites.suites[0].testCases[0];
    expect(errorTest.status).toBe('error');
    expect(errorTest.error).toBeDefined();
    expect(errorTest.error!.type).toBe('RuntimeException');
    expect(errorTest.error!.message).toBe('Unexpected error occurred');
    expect(errorTest.error!.stackTrace).toContain('java.lang.RuntimeException');
  });

  it('should parse skipped tests correctly', async () => {
    const xml = generateTestXML('surefire', { testCount: 1, failures: 0, errors: 0, skipped: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    const skippedTest = result.testSuites.suites[0].testCases[0];
    expect(skippedTest.status).toBe('skipped');
    expect(skippedTest.skipped).toBeDefined();
    expect(skippedTest.skipped!.message).toBe('Test disabled or ignored');
  });

  it('should parse properties correctly', async () => {
    const xml = generateTestXML('surefire', { includeProperties: true });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    const suite = result.testSuites.suites[0];
    expect(suite.properties).toBeDefined();
    expect(suite.properties!['java.version']).toBe('17.0.1');
    expect(suite.properties!['os.name']).toBe('Linux');
    expect(suite.properties!['test.framework']).toBe('JUnit 5');
  });

  it('should parse system output at suite level', async () => {
    const xml = generateTestXML('surefire', { includeSystemOut: true });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'surefire' });
    
    const suite = result.testSuites.suites[0];
    expect(suite.systemOut).toBe('System output content');
    expect(suite.systemErr).toBe('System error content');
  });
});

describe('Gradle Format Parsing', () => {
  it('should parse Gradle-specific attributes', async () => {
    const xml = generateTestXML('gradle', { testCount: 2 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'gradle' });
    
    expect(result.format).toBe('gradle');
    expect(result.testSuites.suites[0].hostname).toBe('gradle-host');
    expect(result.testSuites.suites[0].id).toBe('gradle-1');
  });

  it('should handle Gradle test structure correctly', async () => {
    const xml = generateTestXML('gradle', { suiteCount: 2, testCount: 4, failures: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'gradle' });
    
    expect(result.testSuites.tests).toBe(8); // 2 suites × 4 tests
    expect(result.testSuites.failures).toBe(2); // 2 suites × 1 failure
    expect(result.testSuites.suites).toHaveLength(2);
  });
});

describe('Jest Format Parsing', () => {
  it('should parse Jest-specific attributes', async () => {
    const xml = generateTestXML('jest', { testCount: 3 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'jest' });
    
    expect(result.format).toBe('jest');
    expect(result.testSuites.suites[0]).toBeDefined();
  });

  it('should handle Jest test structure', async () => {
    const xml = generateTestXML('jest', { testCount: 5, failures: 2, skipped: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'jest' });
    
    expect(result.testSuites.tests).toBe(5);
    expect(result.testSuites.failures).toBe(2);
    expect(result.testSuites.skipped).toBe(1);
  });
});

describe('pytest Format Parsing', () => {
  it('should parse pytest XML correctly', async () => {
    const xml = generateTestXML('pytest', { testCount: 4, failures: 1, errors: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'pytest' });
    
    expect(result.format).toBe('pytest');
    expect(result.testSuites.tests).toBe(4);
    expect(result.testSuites.failures).toBe(1);
    expect(result.testSuites.errors).toBe(1);
  });
});

describe('PHPUnit Format Parsing', () => {
  it('should parse PHPUnit XML correctly', async () => {
    const xml = generateTestXML('phpunit', { testCount: 3, failures: 1 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'phpunit' });
    
    expect(result.format).toBe('phpunit');
    expect(result.testSuites.tests).toBe(3);
    expect(result.testSuites.failures).toBe(1);
  });
});

describe('Generic Format Parsing', () => {
  it('should parse generic XML format', async () => {
    const xml = generateTestXML('generic', { testCount: 2 });
    const stream = createStreamFromString(xml);
    
    const result = await parseJUnitXML(stream, { expectedFormat: 'generic' });
    
    expect(result.format).toBe('generic');
    expect(result.testSuites.tests).toBe(2);
    expect(result.warnings).toContain('Used generic parser - some format-specific features may not be available');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('should handle malformed XML gracefully', async () => {
    const malformedXml = generateTestXML('surefire', { malformed: true });
    const stream = createStreamFromString(malformedXml);
    
    await expect(parseJUnitXML(stream)).rejects.toThrow(ParsingFailedException);
  });

  it('should handle empty XML files', async () => {
    const emptyStream = new Readable({ read() { this.push(null); } });
    
    await expect(parseJUnitXML(emptyStream)).rejects.toThrow(ParsingFailedException);
  });

  it('should handle invalid XML characters', async () => {
    const invalidXml = '<?xml version="1.0"?><testsuite>\x00\x01invalid</testsuite>';
    const stream = createStreamFromString(invalidXml);
    
    await expect(parseJUnitXML(stream)).rejects.toThrow(ParsingFailedException);
  });

  it('should handle stream errors', async () => {
    const errorStream = new Readable({
      read() {
        this.emit('error', new Error('Stream error'));
      }
    });
    
    await expect(parseJUnitXML(errorStream)).rejects.toThrow(ParsingFailedException);
  });

  it('should handle very large attribute values', async () => {
    const largeMessage = 'x'.repeat(1000000); // 1MB message
    const xmlWithLargeMessage = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test" tests="1" failures="1">
  <testcase name="test1" classname="Test1">
    <failure type="Error" message="${largeMessage}">Stack trace here</failure>
  </testcase>
</testsuite>`;
    
    const stream = createStreamFromString(xmlWithLargeMessage);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites[0].testCases[0].failure!.message).toBe(largeMessage);
  });

  it('should handle deeply nested XML structure', async () => {
    const deepXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Suite1" tests="1">
    <testcase name="test1" classname="Test1">
      <failure type="Error" message="Failed">
        <nested1>
          <nested2>
            <nested3>Deep content</nested3>
          </nested2>
        </nested1>
      </failure>
    </testcase>
  </testsuite>
</testsuites>`;
    
    const stream = createStreamFromString(deepXml);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites).toHaveLength(1);
    expect(result.testSuites.suites[0].testCases[0].failure).toBeDefined();
  });
});

// ============================================================================
// Memory Efficiency Tests
// ============================================================================

describe('Memory Efficiency', () => {
  it('should handle large XML files without excessive memory usage', async () => {
    const largeXml = generateTestXML('surefire', { 
      suiteCount: 50, 
      testCount: 100, 
      failures: 10,
      includeSystemOut: true 
    });
    const stream = createStreamFromString(largeXml);
    
    const initialMemory = process.memoryUsage().heapUsed;
    const result = await parseJUnitXML(stream);
    const finalMemory = process.memoryUsage().heapUsed;
    
    expect(result.testSuites.tests).toBe(5000); // 50 × 100
    expect(result.testSuites.suites).toHaveLength(50);
    
    // Memory usage should not grow excessively (streaming should help)
    const memoryGrowth = finalMemory - initialMemory;
    expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth
  });

  it('should process very long test names efficiently', async () => {
    const longTestName = 'very_long_test_name_'.repeat(1000);
    const xmlWithLongNames = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Test" tests="3">
  <testcase name="${longTestName}1" classname="Test1" />
  <testcase name="${longTestName}2" classname="Test1" />
  <testcase name="${longTestName}3" classname="Test1" />
</testsuite>`;
    
    const stream = createStreamFromString(xmlWithLongNames);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.tests).toBe(3);
    expect(result.testSuites.suites[0].testCases[0].name).toBe(`${longTestName}1`);
  });

  it('should handle many small test cases efficiently', async () => {
    const xml = generateTestXML('surefire', { testCount: 1000 });
    const stream = createStreamFromString(xml);
    
    const startTime = Date.now();
    const result = await parseJUnitXML(stream);
    const endTime = Date.now();
    
    expect(result.testSuites.tests).toBe(1000);
    expect(result.testSuites.suites[0].testCases).toHaveLength(1000);
    expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
  });
});

// ============================================================================
// Encoding Tests
// ============================================================================

describe('Character Encoding', () => {
  it('should handle UTF-8 encoded content', async () => {
    const utf8Xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="UTF8 Test 测试" tests="1">
  <testcase name="测试用例" classname="测试类">
    <failure message="错误消息">堆栈跟踪信息</failure>
  </testcase>
</testsuite>`;
    
    const stream = createStreamFromString(utf8Xml);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites[0].name).toBe('UTF8 Test 测试');
    expect(result.testSuites.suites[0].testCases[0].name).toBe('测试用例');
    expect(result.testSuites.suites[0].testCases[0].className).toBe('测试类');
    expect(result.testSuites.suites[0].testCases[0].failure!.message).toBe('错误消息');
  });

  it('should handle special XML characters', async () => {
    const xmlWithSpecialChars = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Special &amp; Characters" tests="1">
  <testcase name="test&lt;1&gt;" classname="Test&quot;Class&quot;">
    <failure message="Error &amp; message">Stack &lt;trace&gt; content</failure>
  </testcase>
</testsuite>`;
    
    const stream = createStreamFromString(xmlWithSpecialChars);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites[0].name).toBe('Special & Characters');
    expect(result.testSuites.suites[0].testCases[0].name).toBe('test<1>');
    expect(result.testSuites.suites[0].testCases[0].className).toBe('Test"Class"');
    expect(result.testSuites.suites[0].testCases[0].failure!.message).toBe('Error & message');
  });

  it('should handle CDATA sections', async () => {
    const xmlWithCDATA = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="CDATA Test" tests="1">
  <testcase name="test1" classname="Test1">
    <failure><![CDATA[Raw content with <tags> and & special characters]]></failure>
    <system-out><![CDATA[Console output: <script>alert('test')</script>]]></system-out>
  </testcase>
</testsuite>`;
    
    const stream = createStreamFromString(xmlWithCDATA);
    const result = await parseJUnitXML(stream);
    
    const testCase = result.testSuites.suites[0].testCases[0];
    expect(testCase.failure!.stackTrace).toContain('<tags>');
    expect(testCase.systemOut).toContain('<script>alert(\'test\')</script>');
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('should parse large files within reasonable time limits', async () => {
    const largeXml = generateTestXML('surefire', { 
      suiteCount: 100, 
      testCount: 50,
      failures: 5,
      includeSystemOut: true,
      includeProperties: true
    });
    
    const stream = createStreamFromString(largeXml);
    
    const startTime = Date.now();
    const result = await parseJUnitXML(stream);
    const endTime = Date.now();
    
    expect(result.testSuites.tests).toBe(5000); // 100 × 50
    expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
  });

  it('should handle concurrent parsing efficiently', async () => {
    const xmlContent = generateTestXML('surefire', { testCount: 100, failures: 10 });
    
    const parsePromises = Array.from({ length: 10 }, () => {
      const stream = createStreamFromString(xmlContent);
      return parseJUnitXML(stream);
    });
    
    const startTime = Date.now();
    const results = await Promise.all(parsePromises);
    const endTime = Date.now();
    
    expect(results).toHaveLength(10);
    results.forEach(result => {
      expect(result.testSuites.tests).toBe(100);
      expect(result.testSuites.failures).toBe(10);
    });
    
    expect(endTime - startTime).toBeLessThan(3000); // Should complete within 3 seconds
  });
});

// ============================================================================
// File Parsing Tests
// ============================================================================

describe('File Parsing Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse file using parseJUnitXMLFile', async () => {
    const mockFileContent = generateTestXML('surefire', { testCount: 2 });
    const mockStream = createStreamFromString(mockFileContent);
    
    vi.mocked(createReadStream).mockReturnValue(mockStream as any);
    
    const result = await parseJUnitXMLFile('/path/to/test-results.xml', {
      expectedFormat: 'surefire'
    });
    
    expect(createReadStream).toHaveBeenCalledWith('/path/to/test-results.xml');
    expect(result.format).toBe('surefire');
    expect(result.testSuites.tests).toBe(2);
  });

  it('should parse string content using parseJUnitXMLString', async () => {
    const xmlContent = generateTestXML('gradle', { testCount: 3, failures: 1 });
    
    const result = await parseJUnitXMLString(xmlContent, {
      fileName: 'gradle-results.xml',
      expectedFormat: 'gradle'
    });
    
    expect(result.format).toBe('gradle');
    expect(result.testSuites.tests).toBe(3);
    expect(result.testSuites.failures).toBe(1);
  });

  it('should auto-detect format from filename when parsing string', async () => {
    const xmlContent = generateTestXML('generic', { testCount: 1 });
    
    const result = await parseJUnitXMLString(xmlContent, {
      fileName: 'target/surefire-reports/TEST-MyTest.xml'
    });
    
    // Should detect surefire format from filename pattern
    expect(result.format).toBe('surefire');
  });
});

// ============================================================================
// Edge Cases and Regression Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle test suites without testcases', async () => {
    const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="EmptySuite" tests="0" failures="0" errors="0" skipped="0">
</testsuite>`;
    
    const stream = createStreamFromString(emptyXml);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.tests).toBe(0);
    expect(result.testSuites.suites[0].testCases).toHaveLength(0);
  });

  it('should handle missing attributes gracefully', async () => {
    const minimalXml = `<?xml version="1.0"?>
<testsuite name="MinimalSuite">
  <testcase name="test1"/>
</testsuite>`;
    
    const stream = createStreamFromString(minimalXml);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites[0].name).toBe('MinimalSuite');
    expect(result.testSuites.suites[0].tests).toBe(0); // No tests attribute
    expect(result.testSuites.suites[0].testCases[0].name).toBe('test1');
    expect(result.testSuites.suites[0].testCases[0].status).toBe('passed');
  });

  it('should handle numeric attribute parsing edge cases', async () => {
    const edgeCaseXml = `<?xml version="1.0"?>
<testsuite name="EdgeCase" tests="abc" failures="-1" time="invalid">
  <testcase name="test1" time="0.000000001"/>
</testsuite>`;
    
    const stream = createStreamFromString(edgeCaseXml);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites[0].tests).toBe(0); // Invalid "abc" -> 0
    expect(result.testSuites.suites[0].failures).toBe(0); // Invalid "-1" -> 0
    expect(result.testSuites.suites[0].time).toBe(0); // Invalid "invalid" -> 0
    expect(result.testSuites.suites[0].testCases[0].time).toBe(0.000000001);
  });

  it('should handle mixed content in elements', async () => {
    const mixedContentXml = `<?xml version="1.0"?>
<testsuite name="Mixed" tests="1">
  <testcase name="test1">
    Text before
    <failure>Failure message</failure>
    Text after
  </testcase>
</testsuite>`;
    
    const stream = createStreamFromString(mixedContentXml);
    const result = await parseJUnitXML(stream);
    
    expect(result.testSuites.suites[0].testCases[0].failure).toBeDefined();
    expect(result.testSuites.suites[0].testCases[0].failure!.stackTrace).toBe('Failure message');
  });
});