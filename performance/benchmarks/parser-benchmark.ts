/**
 * JUnit Parser Performance Benchmarks
 */
import { Readable } from "stream";

import { parseJUnitXMLString } from "../apps/api/src/ingestion/junit-parser.js";
import { createOptimizedJUnitParser } from "../apps/api/src/performance/parser-optimizations.js";

import { PerformanceBenchmark } from "./benchmark-framework.js";


export async function runParserBenchmarks() {
  const benchmark = new PerformanceBenchmark();
  
  // Generate test XML data
  const generateJUnitXML = (testCount: number) => {
    const testCases = Array.from({ length: testCount }, (_, i) => `
      <testcase name="test_${i}" classname="TestClass${Math.floor(i/10)}" time="${Math.random()}">
        ${Math.random() > 0.8 ? "<failure message=\"test failed\">stack trace here</failure>" : ""}
      </testcase>
    `).join("");
    
    return `<?xml version="1.0" encoding="UTF-8"?>
    <testsuite name="TestSuite" tests="${testCount}" failures="0" errors="0" time="1.0">
      ${testCases}
    </testsuite>`;
  };

  const smallXml = generateJUnitXML(100);
  const mediumXml = generateJUnitXML(1000);
  const largeXml = generateJUnitXML(10000);
  
  const optimizedParser = createOptimizedJUnitParser({
    maxFileSize: 50 * 1024 * 1024, // 50MB
    chunkSize: 64 * 1024,
    enableMemoryOptimization: true,
  });
  
  console.log("Running JUnit parser performance benchmarks...");
  
  // Small XML parsing
  await benchmark.runBenchmark("Original Parser - Small XML (100 tests)", async () => {
    await parseJUnitXMLString(smallXml);
  }, 10);
  
  await benchmark.runBenchmark("Optimized Parser - Small XML (100 tests)", async () => {
    const stream = Readable.from([smallXml]);
    await optimizedParser.parseStream(stream);
  }, 10);
  
  // Medium XML parsing  
  await benchmark.runBenchmark("Original Parser - Medium XML (1000 tests)", async () => {
    await parseJUnitXMLString(mediumXml);
  }, 5);
  
  await benchmark.runBenchmark("Optimized Parser - Medium XML (1000 tests)", async () => {
    const stream = Readable.from([mediumXml]);
    await optimizedParser.parseStream(stream);
  }, 5);
  
  // Large XML parsing
  await benchmark.runBenchmark("Optimized Parser - Large XML (10000 tests)", async () => {
    const stream = Readable.from([largeXml]);
    await optimizedParser.parseStream(stream);
  }, 1);
  
  return benchmark.generateReport();
}
