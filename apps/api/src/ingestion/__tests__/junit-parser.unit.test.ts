/**
 * Comprehensive Unit Tests for JUnit XML Parser
 * 
 * Tests all parser dialects, edge cases, and performance scenarios
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'stream';
import {
  parseJUnitXMLString,
  parseJUnitXMLFile,
  parseJUnitXMLAdvanced,
  detectJUnitFormat,
  extractJUnitTestCases,
  createJUnitParser,
  type JUnitTestCase,
  type JUnitParseResult,
  type FormatSpecificResult,
} from '../junit-parser.js';
import type { TestSuites, JUnitFormat } from '../types.js';

// Mock file system for file-based tests
vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

describe('JUnit XML Parser', () => {
  describe('Basic XML Parsing', () => {
    it('should parse minimal valid JUnit XML', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="TestSuite" tests="1" failures="0" errors="0" skipped="0" time="0.1">
  <testcase name="testPass" classname="TestClass" time="0.1"/>
</testsuite>`;

      const result = await parseJUnitXMLString(xml);
      
      expect(result.testSuites.tests).toBe(1);
      expect(result.testSuites.failures).toBe(0);
      expect(result.testSuites.errors).toBe(0);
      expect(result.testSuites.skipped).toBe(0);
      expect(result.testSuites.suites).toHaveLength(1);
      expect(result.testSuites.suites[0].name).toBe('TestSuite');
      expect(result.testSuites.suites[0].testCases).toHaveLength(1);
      expect(result.testSuites.suites[0].testCases[0].name).toBe('testPass');
      expect(result.testSuites.suites[0].testCases[0].className).toBe('TestClass');
      expect(result.testSuites.suites[0].testCases[0].status).toBe('passed');
    });

    it('should parse testsuites root element', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="AllTests" tests="2" failures="1" errors="0" time="0.3">
  <testsuite name="Suite1" tests="1" failures="0" errors="0" time="0.1">
    <testcase name="test1" classname="Class1" time="0.1"/>
  </testsuite>
  <testsuite name="Suite2" tests="1" failures="1" errors="0" time="0.2">
    <testcase name="test2" classname="Class2" time="0.2">
      <failure message="Test failed" type="AssertionError">Stack trace here</failure>
    </testcase>
  </testsuite>
</testsuites>`;

      const result = await parseJUnitXMLString(xml);
      
      expect(result.testSuites.name).toBe('AllTests');
      expect(result.testSuites.tests).toBe(2);
      expect(result.testSuites.failures).toBe(1);
      expect(result.testSuites.suites).toHaveLength(2);
      
      // Check first suite
      const suite1 = result.testSuites.suites[0];
      expect(suite1.name).toBe('Suite1');
      expect(suite1.testCases[0].status).toBe('passed');
      
      // Check second suite with failure
      const suite2 = result.testSuites.suites[1];
      expect(suite2.name).toBe('Suite2');
      expect(suite2.testCases[0].status).toBe('failed');
      expect(suite2.testCases[0].failure?.message).toBe('Test failed');
      expect(suite2.testCases[0].failure?.type).toBe('AssertionError');
      expect(suite2.testCases[0].failure?.stackTrace).toBe('Stack trace here');
    });

    it('should handle all test case statuses', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="StatusTests" tests="4" failures="1" errors="1" skipped="1" time="0.4">
  <testcase name="testPassed" classname="StatusClass" time="0.1"/>
  <testcase name="testFailed" classname="StatusClass" time="0.1">
    <failure message="Assertion failed" type="AssertionError">
      Expected: true
      Actual: false
    </failure>
  </testcase>
  <testcase name="testError" classname="StatusClass" time="0.1">
    <error message="Runtime error" type="RuntimeException">
      NullPointerException at line 42
    </error>
  </testcase>
  <testcase name="testSkipped" classname="StatusClass" time="0.1">
    <skipped message="Test skipped due to condition"/>
  </testcase>
</testsuite>`;

      const result = await parseJUnitXMLString(xml);
      const testCases = result.testSuites.suites[0].testCases;
      
      expect(testCases).toHaveLength(4);
      
      // Passed test
      expect(testCases[0].name).toBe('testPassed');
      expect(testCases[0].status).toBe('passed');
      
      // Failed test
      expect(testCases[1].name).toBe('testFailed');
      expect(testCases[1].status).toBe('failed');
      expect(testCases[1].failure?.message).toBe('Assertion failed');
      expect(testCases[1].failure?.stackTrace).toContain('Expected: true');
      
      // Error test
      expect(testCases[2].name).toBe('testError');
      expect(testCases[2].status).toBe('error');
      expect(testCases[2].error?.message).toBe('Runtime error');
      expect(testCases[2].error?.stackTrace).toContain('NullPointerException');
      
      // Skipped test
      expect(testCases[3].name).toBe('testSkipped');
      expect(testCases[3].status).toBe('skipped');
      expect(testCases[3].skipped?.message).toBe('Test skipped due to condition');
    });

    it('should handle system-out and system-err', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="SystemOutputTests" tests="1">
  <testcase name="testWithOutput" classname="OutputClass">
    <system-out>Console output from test</system-out>
    <system-err>Error output from test</system-err>
  </testcase>
  <system-out>Suite-level console output</system-out>
  <system-err>Suite-level error output</system-err>
</testsuite>`;

      const result = await parseJUnitXMLString(xml);
      const suite = result.testSuites.suites[0];
      const testCase = suite.testCases[0];
      
      expect((testCase as any).systemOut).toBe('Console output from test');
      expect((testCase as any).systemErr).toBe('Error output from test');
      expect((suite as any).systemOut).toBe('Suite-level console output');
      expect((suite as any).systemErr).toBe('Suite-level error output');
    });

    it('should handle properties', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="PropertiesTest" tests="1">
  <properties>
    <property name="java.version" value="11.0.1"/>
    <property name="os.name" value="Linux"/>
    <property name="test.framework" value="JUnit"/>
  </properties>
  <testcase name="testWithProps" classname="PropClass"/>
</testsuite>`;

      const result = await parseJUnitXMLString(xml);
      const suite = result.testSuites.suites[0];
      
      expect(suite.properties).toEqual({
        'java.version': '11.0.1',
        'os.name': 'Linux',
        'test.framework': 'JUnit',
      });
    });
  });

  describe('Format Detection', () => {
    it('should detect Surefire format', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.SurefireTest" tests="1">
  <properties>
    <property name="maven.version" value="3.8.1"/>
    <property name="surefire.version" value="3.0.0-M5"/>
  </properties>
  <testcase name="testSurefire" classname="com.example.SurefireTest"/>
</testsuite>`;

      const stream = new Readable({
        read() {
          this.push(xml);
          this.push(null);
        }
      });

      const detection = await detectJUnitFormat(stream);
      expect(detection.format).toBe('surefire');
      expect(detection.confidence).toBeGreaterThan(0.5);
      expect(detection.indicators).toContain('surefire keywords detected');
    });

    it('should detect Jest format', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="1">
  <testsuite name="test.spec.js" tests="1">
    <testcase classname="test.spec.js" name="should work"/>
  </testsuite>
</testsuites>`;

      const stream = new Readable({
        read() {
          this.push(xml);
          this.push(null);
        }
      });

      const detection = await detectJUnitFormat(stream, 'test.spec.js.xml');
      expect(detection.format).toBe('jest');
      expect(detection.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Gradle format', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="GradleTest" tests="1">
  <properties>
    <property name="gradle.version" value="7.2"/>
  </properties>
  <testcase name="testGradle" classname="GradleTest"/>
</testsuite>`;

      const stream = new Readable({
        read() {
          this.push(xml);
          this.push(null);
        }
      });

      const detection = await detectJUnitFormat(stream);
      expect(detection.format).toBe('gradle');
      expect(detection.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Pytest format', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="test_module.py" tests="1">
  <testcase classname="test_module.py::TestClass" name="test_function"/>
</testsuite>`;

      const stream = new Readable({
        read() {
          this.push(xml);
          this.push(null);
        }
      });

      const detection = await detectJUnitFormat(stream);
      expect(detection.format).toBe('pytest');
      expect(detection.confidence).toBeGreaterThan(0.3);
    });

    it('should detect PHPUnit format', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="PHPUnitTest" tests="1">
  <properties>
    <property name="phpunit.version" value="9.5"/>
  </properties>
  <testcase name="testExample" classname="PHPUnitTest"/>
</testsuite>`;

      const stream = new Readable({
        read() {
          this.push(xml);
          this.push(null);
        }
      });

      const detection = await detectJUnitFormat(stream);
      expect(detection.format).toBe('phpunit');
      expect(detection.confidence).toBeGreaterThan(0.3);
    });

    it('should fallback to generic format for unknown content', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="UnknownTest" tests="1">
  <testcase name="test" classname="UnknownClass"/>
</testsuite>`;

      const stream = new Readable({
        read() {
          this.push(xml);
          this.push(null);
        }
      });

      const detection = await detectJUnitFormat(stream);
      expect(detection.format).toBe('generic');
      expect(detection.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe('JUnitTestCase Extraction', () => {
    it('should extract test cases with all metadata', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="ExtractTest" tests="2">
  <testcase name="testPass" classname="com.example.TestClass" time="0.123"/>
  <testcase name="testFail" classname="com.example.TestClass" time="0.456">
    <failure message="Test failed" type="AssertionError">
      at TestClass.testFail(TestClass.java:25)
    </failure>
  </testcase>
</testsuite>`;

      const parseResult = await parseJUnitXMLString(xml);
      const testCases = extractJUnitTestCases(parseResult.testSuites);
      
      expect(testCases).toHaveLength(2);
      
      // Passed test case
      expect(testCases[0]).toEqual({
        suite: 'ExtractTest',
        class: 'com.example.TestClass',
        name: 'testPass',
        time: 0.123,
        status: 'passed',
        file: 'com.example', // Extracted from class name
      });
      
      // Failed test case
      expect(testCases[1]).toEqual({
        suite: 'ExtractTest',
        class: 'com.example.TestClass',
        name: 'testFail',
        time: 0.456,
        status: 'failed',
        message: 'Test failed',
        stack: 'at TestClass.testFail(TestClass.java:25)',
        file: 'com.example', // Extracted from class name
      });
    });

    it('should extract file paths from different naming patterns', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="PathExtractionTest" tests="4">
  <testcase name="testJava" classname="com.example.JavaTest" time="0.1"/>
  <testcase name="testPython" classname="test_module.py::TestClass" time="0.1"/>
  <testcase name="testJavaScript" classname="components/Button.test.js" time="0.1"/>
  <testcase name="testCSharp" classname="MyApp.Tests.ButtonTests" time="0.1"/>
</testsuite>`;

      const parseResult = await parseJUnitXMLString(xml);
      const testCases = extractJUnitTestCases(parseResult.testSuites);
      
      expect(testCases).toHaveLength(4);
      
      // Java package path
      expect(testCases[0].file).toBe('com.example');
      
      // Python module path
      expect(testCases[1].file).toBe('test_module.py');
      
      // JavaScript file path
      expect(testCases[2].file).toBe('components/Button.test.js');
      
      // C# namespace
      expect(testCases[3].file).toBe('MyApp.Tests');
    });
  });

  describe('Advanced Parsing Features', () => {
    it('should return comprehensive parse result with format-specific metadata', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="AdvancedTest" tests="1">
  <properties>
    <property name="maven.version" value="3.8.1"/>
    <property name="surefire.version" value="3.0.0"/>
  </properties>
  <testcase name="test" classname="com.example.AdvancedTest" time="0.1"/>
</testsuite>`;

      const result = await parseJUnitXMLAdvanced(xml, {
        expectedFormat: 'surefire',
        extractTestCases: true,
      });

      expect(result.format).toBe('surefire');
      expect(result.testSuites.tests).toBe(1);
      expect(result.testCases).toHaveLength(1);
      expect(result.processingStats).toHaveProperty('bytesParsed');
      expect(result.processingStats).toHaveProperty('parsingTimeMs');
      expect(result.warnings).toBeDefined();
      
      // Format-specific metadata
      const metadata = result.metadata as FormatSpecificResult<'surefire'>;
      expect(metadata.surefireSpecific).toBeDefined();
      expect(metadata.surefireSpecific.mavenVersion).toBe('3.8.1');
    });

    it('should handle CDATA sections', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="CDATATest" tests="1">
  <testcase name="testCDATA" classname="CDATAClass">
    <failure message="Test failed"><![CDATA[
      Complex stack trace with <special> characters & symbols
      Line 1: Error occurred
      Line 2: Additional info
    ]]></failure>
    <system-out><![CDATA[
      Console output with <xml> tags and & entities
    ]]></system-out>
  </testcase>
</testsuite>`;

      const result = await parseJUnitXMLString(xml);
      const testCase = result.testSuites.suites[0].testCases[0];
      
      expect(testCase.failure?.stackTrace).toContain('Complex stack trace with <special> characters');
      expect(testCase.failure?.stackTrace).toContain('Line 1: Error occurred');
      expect((testCase as any).systemOut).toContain('Console output with <xml> tags');
    });

    it('should handle timestamp attributes', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites timestamp="2023-10-01T10:30:00.123Z">
  <testsuite name="TimestampTest" tests="1" timestamp="2023-10-01T10:30:01.456Z">
    <testcase name="test" classname="TimestampClass" time="0.1"/>
  </testsuite>
</testsuites>`;

      const result = await parseJUnitXMLString(xml);
      
      expect(result.testSuites.timestamp).toBe('2023-10-01T10:30:00.123Z');
      expect(result.testSuites.suites[0].timestamp).toBe('2023-10-01T10:30:01.456Z');
    });

    it('should handle empty and missing attributes gracefully', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="MissingAttrsTest">
  <testcase name="testMissing"/>
  <testcase name="testEmpty" classname="" time=""/>
  <testcase name="testZero" time="0"/>
</testsuite>`;

      const result = await parseJUnitXMLString(xml);
      const testCases = result.testSuites.suites[0].testCases;
      
      expect(testCases).toHaveLength(3);
      
      // Missing attributes should use defaults
      expect(testCases[0].time).toBe(0);
      expect(testCases[0].className).toBeUndefined();
      
      // Empty attributes should use defaults
      expect(testCases[1].className).toBe('');
      expect(testCases[1].time).toBe(0);
      
      // Zero values should be preserved
      expect(testCases[2].time).toBe(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed XML gracefully', async () => {
      const malformedXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="MalformedTest" tests="1">
  <testcase name="test" classname="TestClass"
</testsuite>`;

      await expect(parseJUnitXMLString(malformedXml))
        .rejects.toThrow('Failed to parse JUnit XML');
    });

    it('should handle empty XML content', async () => {
      const emptyXml = '';

      await expect(parseJUnitXMLString(emptyXml))
        .rejects.toThrow('Failed to parse JUnit XML');
    });

    it('should handle XML with no test cases', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="EmptyTest" tests="0" failures="0" errors="0"/>`;

      const result = await parseJUnitXMLString(xml);
      
      expect(result.testSuites.tests).toBe(0);
      expect(result.testSuites.suites[0].testCases).toHaveLength(0);
    });

    it('should handle large XML content efficiently', async () => {
      const largeTestCount = 1000;
      const testCases = Array.from({ length: largeTestCount }, (_, i) => 
        `<testcase name="test${i}" classname="LargeTestClass" time="0.001"/>`
      ).join('\n  ');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="LargeTest" tests="${largeTestCount}">
  ${testCases}
</testsuite>`;

      const startTime = Date.now();
      const result = await parseJUnitXMLString(xml);
      const parseTime = Date.now() - startTime;
      
      expect(result.testSuites.tests).toBe(largeTestCount);
      expect(result.testSuites.suites[0].testCases).toHaveLength(largeTestCount);
      expect(parseTime).toBeLessThan(5000); // Should parse in under 5 seconds
    });

    it('should handle deeply nested XML structure', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Nested1" tests="1">
    <properties>
      <property name="level" value="1"/>
    </properties>
    <testcase name="test1" classname="Level1">
      <system-out>Level 1 output</system-out>
    </testcase>
  </testsuite>
</testsuites>`;

      const result = await parseJUnitXMLString(xml);
      
      expect(result.testSuites.suites).toHaveLength(1);
      expect(result.testSuites.suites[0].properties?.level).toBe('1');
      expect((result.testSuites.suites[0].testCases[0] as any).systemOut).toBe('Level 1 output');
    });

    it('should validate test count consistency', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="InconsistentTest" tests="3" failures="1" errors="1" skipped="1">
  <testcase name="test1" classname="TestClass"/>
  <testcase name="test2" classname="TestClass">
    <failure message="Failed"/>
  </testcase>
</testsuite>`;

      // Should not throw but might log a warning
      const result = await parseJUnitXMLString(xml);
      
      expect(result.testSuites.tests).toBe(3);
      expect(result.testSuites.suites[0].testCases).toHaveLength(2);
    });

    it('should handle negative test counts gracefully', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="NegativeTest" tests="-1" failures="-1">
  <testcase name="test" classname="TestClass"/>
</testsuite>`;

      await expect(parseJUnitXMLString(xml, { validateResult: true }))
        .rejects.toThrow('Test counts cannot be negative');
    });
  });

  describe('Parser Factory and Configuration', () => {
    it('should create parser with specific format', () => {
      const surefireParser = createJUnitParser('surefire', {
        strictMode: true,
        includeSystemProperties: true,
      });
      
      expect(surefireParser).toBeDefined();
      expect((surefireParser as any).format).toBe('surefire');
    });

    it('should create parser with stream options', () => {
      const parser = createJUnitParser('jest', {}, {
        highWaterMark: 64 * 1024,
        objectMode: false,
      });
      
      expect(parser).toBeDefined();
      expect((parser as any).maxFileSizeBytes).toBe(64 * 1024);
    });

    it('should handle all supported formats', () => {
      const formats: JUnitFormat[] = ['surefire', 'gradle', 'jest', 'pytest', 'phpunit', 'generic'];
      
      formats.forEach(format => {
        const parser = createJUnitParser(format);
        expect(parser).toBeDefined();
        expect((parser as any).format).toBe(format);
      });
    });
  });

  describe('Performance and Memory Tests', () => {
    it('should handle large files without memory issues', async () => {
      // Create a large XML with many test cases
      const testCount = 5000;
      const testCases = Array.from({ length: testCount }, (_, i) => 
        `<testcase name="perfTest${i}" classname="PerfTestClass" time="${(Math.random() * 10).toFixed(3)}">
          ${i % 10 === 0 ? '<failure message="Random failure">Stack trace ' + i + '</failure>' : ''}
        </testcase>`
      ).join('\n  ');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="PerformanceTest" tests="${testCount}" failures="${Math.floor(testCount / 10)}">
  ${testCases}
</testsuite>`;

      const initialMemory = process.memoryUsage().heapUsed;
      const result = await parseJUnitXMLString(xml);
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024); // MB

      expect(result.testSuites.tests).toBe(testCount);
      expect(result.testSuites.suites[0].testCases).toHaveLength(testCount);
      expect(memoryIncrease).toBeLessThan(100); // Should use less than 100MB additional memory
      expect(result.processingTimeMs).toBeGreaterThan(0);
    });

    it('should provide processing statistics', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="StatsTest" tests="1">
  <testcase name="test" classname="StatsClass" time="0.1"/>
</testsuite>`;

      const result = await parseJUnitXMLAdvanced(xml, {
        extractTestCases: true,
      });
      
      expect(result.processingStats).toHaveProperty('bytesParsed');
      expect(result.processingStats).toHaveProperty('parsingTimeMs');
      expect(result.processingStats).toHaveProperty('elementsProcessed');
      expect(result.processingStats).toHaveProperty('memoryPeakMB');
      expect(result.processingStats.parsingTimeMs).toBeGreaterThan(0);
    });
  });

  describe('Specific Format Features', () => {
    it('should handle Surefire-specific attributes', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="SurefireSpecific" tests="1" package="com.example" hostname="localhost">
  <properties>
    <property name="maven.version" value="3.8.1"/>
    <property name="java.version" value="11.0.1"/>
  </properties>
  <testcase name="test" classname="com.example.SurefireTest"/>
</testsuite>`;

      const result = await parseJUnitXMLString(xml, {
        expectedFormat: 'surefire',
      });
      
      const suite = result.testSuites.suites[0];
      expect(suite.package).toBe('com.example');
      expect(suite.hostname).toBe('localhost');
      expect(suite.properties?.['maven.version']).toBe('3.8.1');
      expect(suite.properties?.['java.version']).toBe('11.0.1');
    });

    it('should handle Jest-specific naming patterns', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Jest Tests">
  <testsuite name="Button.test.js" tests="2">
    <testcase classname="Button.test.js" name="Button should render correctly" time="0.023"/>
    <testcase classname="Button.test.js" name="Button should handle click events" time="0.012"/>
  </testsuite>
</testsuites>`;

      const result = await parseJUnitXMLString(xml, {
        expectedFormat: 'jest',
      });
      
      expect(result.format).toBe('jest');
      expect(result.testSuites.suites[0].name).toBe('Button.test.js');
      expect(result.testSuites.suites[0].testCases[0].name).toBe('Button should render correctly');
    });

    it('should handle Pytest module and class patterns', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="test_calculator.py" tests="2">
  <testcase classname="test_calculator.py::TestCalculator" name="test_add" time="0.001"/>
  <testcase classname="test_calculator.py::TestCalculator" name="test_subtract" time="0.001"/>
</testsuite>`;

      const result = await parseJUnitXMLString(xml, {
        expectedFormat: 'pytest',
      });
      
      expect(result.format).toBe('pytest');
      expect(result.testSuites.suites[0].testCases[0].className).toBe('test_calculator.py::TestCalculator');
      
      // Extract test cases to verify file extraction
      const testCases = extractJUnitTestCases(result.testSuites);
      expect(testCases[0].file).toBe('test_calculator.py');
    });
  });
});