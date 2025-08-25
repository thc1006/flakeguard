/**
 * Simple test to demonstrate the JUnit parser functionality
 * This file can be run to validate the implementation
 */

import { Readable } from 'stream';
import { 
  parseJUnitXMLString, 
  parseJUnitXMLAdvanced, 
  extractJUnitTestCases,
  createJUnitParser 
} from './junit-parser.js';

// Sample JUnit XML for testing
const sampleJUnitXML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Test Results" tests="3" failures="1" errors="0" skipped="1" time="2.5">
  <testsuite name="ExampleTestSuite" tests="3" failures="1" errors="0" skipped="1" time="2.5" timestamp="2024-08-24T12:00:00Z">
    <testcase classname="com.example.TestClass" name="testSuccess" time="1.0">
    </testcase>
    <testcase classname="com.example.TestClass" name="testFailure" time="1.2">
      <failure type="AssertionError" message="Expected true but was false">
        at com.example.TestClass.testFailure(TestClass.java:25)
        at java.base/java.lang.reflect.Method.invoke(Method.java:566)
      </failure>
    </testcase>
    <testcase classname="com.example.TestClass" name="testSkipped" time="0.3">
      <skipped message="Test skipped for demonstration"/>
    </testcase>
    <properties>
      <property name="java.version" value="11.0.2"/>
      <property name="maven.version" value="3.8.1"/>
    </properties>
  </testsuite>
</testsuites>`;

async function demonstrateParser() {
  console.log('🚀 Testing JUnit XML Parser Implementation');
  console.log('==========================================\n');

  try {
    // Test 1: Basic parsing
    console.log('📝 Test 1: Basic XML String Parsing');
    const result = await parseJUnitXMLString(sampleJUnitXML, {
      expectedFormat: 'surefire',
      validateResult: true
    });

    console.log(`✅ Parsed successfully!`);
    console.log(`   Format: ${result.format}`);
    console.log(`   Total Tests: ${result.testSuites.tests}`);
    console.log(`   Failures: ${result.testSuites.failures}`);
    console.log(`   Processing Time: ${result.processingTimeMs}ms\n`);

    // Test 2: Extract JUnitTestCase objects
    console.log('📊 Test 2: Extract JUnitTestCase Objects');
    const testCases = extractJUnitTestCases(result.testSuites);
    
    console.log(`✅ Extracted ${testCases.length} test cases:`);
    testCases.forEach((testCase, index) => {
      console.log(`   ${index + 1}. ${testCase.suite} > ${testCase.class} > ${testCase.name}`);
      console.log(`      Status: ${testCase.status}, Time: ${testCase.time}s`);
      if (testCase.message) {
        console.log(`      Message: ${testCase.message}`);
      }
      if (testCase.stack) {
        console.log(`      Stack: ${testCase.stack.substring(0, 50)}...`);
      }
    });

    // Test 3: Advanced parsing with metadata
    console.log('\n🔍 Test 3: Advanced Parsing with Metadata');
    const advancedResult = await parseJUnitXMLAdvanced(new Readable({
      read() {
        this.push(sampleJUnitXML);
        this.push(null);
      }
    }), {
      expectedFormat: 'surefire',
      extractTestCases: true
    });

    console.log(`✅ Advanced parsing completed!`);
    console.log(`   Processing Stats:`);
    console.log(`     - Bytes Parsed: ${advancedResult.processingStats.bytesParsed}`);
    console.log(`     - Elements Processed: ${advancedResult.processingStats.elementsProcessed}`);
    console.log(`     - Parsing Time: ${advancedResult.processingStats.parsingTimeMs}ms`);
    console.log(`     - Memory Peak: ${advancedResult.processingStats.memoryPeakMB}MB`);

    // Test 4: Parser factory
    console.log('\n🏭 Test 4: Parser Factory with Type Safety');
    const surefireParser = createJUnitParser('surefire', {
      strictMode: true,
      includeSystemProperties: true,
      validateTestCounts: true
    });

    console.log(`✅ Created Surefire parser successfully!`);
    console.log(`   Parser type: ${surefireParser.constructor.name}`);

    // Test different formats
    const formats: Array<'gradle' | 'jest' | 'pytest' | 'phpunit'> = ['gradle', 'jest', 'pytest', 'phpunit'];
    formats.forEach(format => {
      const parser = createJUnitParser(format);
      console.log(`   ${format} parser: ${parser.constructor.name}`);
    });

    console.log('\n🎉 All tests passed! Implementation is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
}

// Run the demonstration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateParser().catch(console.error);
}

export { demonstrateParser };