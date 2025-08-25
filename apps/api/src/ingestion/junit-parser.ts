/**
 * Advanced JUnit XML streaming parser with format-specific support
 * Uses SAX parsing for memory efficiency and supports multiple JUnit formats
 * 
 * Features:
 * - Memory-efficient streaming with SAX parser
 * - Support for multiple JUnit formats (Surefire, Gradle, Jest, pytest, PHPUnit)
 * - Advanced TypeScript typing with generics and conditional types
 * - Robust error handling and edge case management
 * - Format detection and auto-configuration
 * - Large file handling with configurable memory limits
 */

import { createReadStream } from 'fs';
import { pipeline, Transform, Readable } from 'stream';
import { promisify } from 'util';

import * as sax from 'sax';

import type {
  TestCase,
  TestSuite,
  TestSuites,
  TestFailure,
  TestCaseStatus,
  JUnitFormat,
  FormatDetectionResult,
  StreamProcessingOptions
} from './types.js';
import { ParsingFailedException } from './types.js';
import { detectFormatFromPath } from './utils.js';

// ============================================================================
// Core JUnit Test Case Interface (as specified in requirements)
// ============================================================================

/**
 * Core JUnit test case interface with comprehensive test information
 * Represents a single test case with all relevant metadata and results
 */
interface JUnitTestCase {
  /** Test suite name */
  suite: string;
  /** Test class name (optional for non-OOP languages) */
  class?: string;
  /** Test method/function name */
  name: string;
  /** Execution time in seconds */
  time: number;
  /** Test execution status */
  status: 'passed' | 'failed' | 'error' | 'skipped';
  /** Failure/error message (for failed/error tests) */
  message?: string;
  /** Stack trace (for failed/error tests) */
  stack?: string;
  /** Source file path (when available) */
  file?: string;
}


// ============================================================================
// Advanced TypeScript Utility Types and Type-Level Programming
// ============================================================================

/**
 * Deep readonly utility type for immutable configurations
 */
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object 
    ? T[P] extends (...args: unknown[]) => unknown
      ? T[P] 
      : DeepReadonly<T[P]>
    : T[P];
};

/**
 * Extract keys with specific value types
 */
type KeysWithValueType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

/**
 * Conditional parser result type based on format
 */
type FormatSpecificResult<T extends JUnitFormat> = T extends 'surefire'
  ? { surefireSpecific: { mavenVersion?: string; testClassLoader?: string } }
  : T extends 'gradle' 
  ? { gradleSpecific: { taskName?: string; gradleVersion?: string } }
  : T extends 'jest'
  ? { jestSpecific: { jestVersion?: string; coverageData?: unknown } }
  : T extends 'pytest' 
  ? { pytestSpecific: { pythonVersion?: string; fixtures?: string[] } }
  : T extends 'phpunit'
  ? { phpunitSpecific: { phpVersion?: string; coverageFormat?: string } }
  : { genericData: Record<string, unknown> };

/**
 * Mapped type for transforming test case data
 */
type TransformTestCase<T> = {
  [K in keyof T]: K extends 'time' 
    ? number
    : K extends 'status'
    ? 'passed' | 'failed' | 'error' | 'skipped'
    : T[K];
};

/**
 * Advanced result mapping with format-specific transformations
 */
type JUnitParseResult<T extends JUnitFormat> = {
  testSuites: TestSuites;
  testCases: TransformTestCase<JUnitTestCase>[];
  format: T;
  metadata: FormatSpecificResult<T>;
  processingStats: {
    readonly bytesParsed: number;
    readonly elementsProcessed: number;
    readonly parsingTimeMs: number;
    readonly memoryPeakMB: number;
  };
  warnings: ReadonlyArray<string>;
};

// ============================================================================
// Advanced TypeScript Types and Interfaces
// ============================================================================

/**
 * Conditional type for format-specific parser configuration
 */
type ParserConfigMap = {
  surefire: SurefireConfig;
  gradle: GradleConfig;
  jest: JestConfig;
  pytest: PytestConfig;
  phpunit: PHPUnitConfig;
  generic: GenericConfig;
};

/**
 * Extract specific config type based on format
 */
type ExtractConfig<T extends JUnitFormat> = T extends keyof ParserConfigMap 
  ? ParserConfigMap[T] 
  : GenericConfig;

/**
 * Format-specific configuration interfaces
 */
interface SurefireConfig {
  readonly strictMode?: boolean;
  readonly includeSystemProperties?: boolean;
  readonly validateTestCounts?: boolean;
  readonly timeoutMs?: number;
}

interface GradleConfig {
  readonly gradleVersion?: string;
  readonly includeStandardStreams?: boolean;
  readonly parseClasspath?: boolean;
  readonly timeoutMs?: number;
}

interface JestConfig {
  readonly jestVersion?: string;
  readonly collectCoverage?: boolean;
  readonly includeSnapshots?: boolean;
  readonly timeoutMs?: number;
}

interface PytestConfig {
  readonly pytestVersion?: string;
  readonly includeProperties?: boolean;
  readonly parseFixtures?: boolean;
  readonly timeoutMs?: number;
}

interface PHPUnitConfig {
  readonly phpunitVersion?: string;
  readonly includeCodeCoverage?: boolean;
  readonly parseSuites?: boolean;
  readonly timeoutMs?: number;
}

interface GenericConfig {
  readonly customAttributes?: readonly string[];
  readonly strictValidation?: boolean;
  readonly timeoutMs?: number;
}

/**
 * Parser state management with immutable design patterns
 */

/**
 * Mutable parser state for internal operations
 */
interface MutableParserState {
  format: JUnitFormat;
  currentPath: string[];
  testSuites: TestSuites;
  currentSuite?: TestSuite;
  currentTestCase?: TestCase;
  currentElement?: {
    name: string;
    attributes: Record<string, string>;
    text: string;
  };
  warnings: string[];
  processingTimeMs: number;
  byteCount: number;
  elementDepth: number;
  maxDepth: number;
}

/**
 * Advanced element handler with context information
 */
type ElementHandler<T extends JUnitFormat = JUnitFormat> = (
  state: MutableParserState,
  name: string,
  attributes: Readonly<Record<string, string>>,
  context: ParsingContext<T>
) => void;

/**
 * Parsing context with format-specific information
 */
interface ParsingContext<T extends JUnitFormat> {
  readonly format: T;
  readonly config: ExtractConfig<T>;
  readonly startTime: number;
  readonly maxFileSizeBytes: number;
}

/**
 * Memory-efficient attribute parser with type safety
 */
interface AttributeParser {
  getInt(key: string, defaultValue?: number): number;
  getFloat(key: string, defaultValue?: number): number;
  getString(key: string, defaultValue?: string): string;
  getBoolean(key: string, defaultValue?: boolean): boolean;
  getTimestamp(key: string): string | undefined;
  hasAttribute(key: string): boolean;
}

// ============================================================================
// Abstract Base Parser with Advanced Features
// ============================================================================

/**
 * Abstract base parser class implementing streaming SAX parsing
 */
abstract class BaseJUnitParser<T extends JUnitFormat = JUnitFormat> {
  protected readonly format: T;
  protected readonly config: ExtractConfig<T>;
  protected readonly maxFileSizeBytes: number;
  protected readonly maxElementDepth: number;

  constructor(format: T, config: ExtractConfig<T>, options: StreamProcessingOptions = {}) {
    this.format = format;
    this.config = config;
    this.maxFileSizeBytes = options.highWaterMark || 50 * 1024 * 1024; // 50MB default
    this.maxElementDepth = 100; // Prevent stack overflow from deeply nested XML
  }

  /**
   * Parse XML content from stream using SAX parser
   */
  async parseFromStream(stream: Readable): Promise<TestSuites> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const state: MutableParserState = {
        format: this.format,
        currentPath: [],
        testSuites: {
          tests: 0,
          failures: 0,
          errors: 0,
          skipped: 0,
          suites: [] as TestSuite[]
        },
        warnings: [],
        processingTimeMs: 0,
        byteCount: 0,
        elementDepth: 0,
        maxDepth: 0
      };

      const context: ParsingContext<T> = {
        format: this.format,
        config: this.config,
        startTime,
        maxFileSizeBytes: this.maxFileSizeBytes
      };

      // Create SAX parser with strict mode for better error detection
      const parser = sax.createStream(true, {
        trim: true,
        normalize: true,
        lowercase: false,
        xmlns: false,
        position: true
      });

      // Configure parser event handlers
      this.setupParserHandlers(parser, state, context, resolve, reject);

      // Setup stream processing with memory monitoring
      this.setupStreamProcessing(stream, parser, state, reject);
    });
  }

  /**
   * Setup SAX parser event handlers with enhanced memory and performance tracking
   */
  private setupParserHandlers(
    parser: sax.SAXStream,
    state: MutableParserState,
    context: ParsingContext<T>,
    resolve: (result: TestSuites) => void,
    reject: (error: Error) => void
  ): void {
    let elementsProcessed = 0;
    let memoryPeakMB = 0;

    // Monitor memory usage periodically
    const memoryMonitorInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const currentMemoryMB = memUsage.heapUsed / (1024 * 1024);
      memoryPeakMB = Math.max(memoryPeakMB, currentMemoryMB);
    }, 100);

    const cleanup = () => {
      clearInterval(memoryMonitorInterval);
    };

    parser.on('opentag', (node: { name: string; attributes: Record<string, string> }) => {
      try {
        elementsProcessed++;
        state.elementDepth++;
        state.maxDepth = Math.max(state.maxDepth, state.elementDepth);
        
        if (state.elementDepth > this.maxElementDepth) {
          cleanup();
          throw new Error(`XML structure too deep (>${this.maxElementDepth} levels)`);
        }

        // Backpressure handling for large documents
        if (elementsProcessed % 10000 === 0) {
          setImmediate(() => {
            this.handleOpenTag(state, node.name, node.attributes, context);
          });
        } else {
          this.handleOpenTag(state, node.name, node.attributes, context);
        }
      } catch (error) {
        cleanup();
        reject(this.createParsingError(error, state));
      }
    });

    parser.on('text', (text: string) => {
      try {
        if (text.trim() && state.currentElement) {
          state.currentElement.text += text;
        }
      } catch (error) {
        reject(this.createParsingError(error, state));
      }
    });

    parser.on('cdata', (cdata: string) => {
      try {
        if (state.currentElement) {
          state.currentElement.text += cdata;
        }
      } catch (error) {
        reject(this.createParsingError(error, state));
      }
    });

    parser.on('closetag', (nodeName: string) => {
      try {
        state.elementDepth--;
        this.handleCloseTag(state, nodeName, context);
      } catch (error) {
        reject(this.createParsingError(error, state));
      }
    });

    parser.on('error', (error: Error) => {
      cleanup();
      reject(this.createParsingError(error, state));
    });

    parser.on('end', () => {
      try {
        cleanup();
        state.processingTimeMs = Date.now() - context.startTime;
        
        // Add processing statistics to state
        (state as MutableParserState & { elementsProcessed: number; memoryPeakMB: number }).elementsProcessed = elementsProcessed;
        (state as MutableParserState & { elementsProcessed: number; memoryPeakMB: number }).memoryPeakMB = memoryPeakMB;
        
        const result = this.finalizeResult(state);
        resolve(result);
      } catch (error) {
        cleanup();
        reject(this.createParsingError(error, state));
      }
    });
  }

  /**
   * Setup stream processing with memory monitoring
   */
  private setupStreamProcessing(
    stream: Readable,
    parser: sax.SAXStream,
    state: MutableParserState,
    reject: (error: Error) => void
  ): void {
    // Transform stream to monitor byte count and enforce limits
    const maxSize = this.maxFileSizeBytes;
    const monitoringTransform = new Transform({
      transform(chunk, encoding, callback) {
        state.byteCount += chunk.length;
        
        if (state.byteCount > maxSize) {
          return callback(new Error(
            `File size exceeds maximum allowed size of ${maxSize} bytes`
          ));
        }
        
        callback(null, chunk);
      }
    });

    // Setup stream pipeline
    stream
      .pipe(monitoringTransform)
      .pipe(parser)
      .on('error', (error: Error) => {
        reject(this.createParsingError(error, state));
      });

    stream.on('error', (error: Error) => {
      reject(this.createParsingError(error, state));
    });
  }

  /**
   * Handle opening XML tag with format-specific logic
   */
  protected handleOpenTag(
    state: MutableParserState,
    name: string,
    attributes: Readonly<Record<string, string>>,
    context: ParsingContext<T>
  ): void {
    state.currentPath.push(name);
    
    const handler = this.getOpenTagHandler(name);
    if (handler) {
      handler(state, name, attributes, context);
    }
  }

  /**
   * Handle closing XML tag with cleanup
   */
  protected handleCloseTag(
    state: MutableParserState,
    name: string,
    context: ParsingContext<T>
  ): void {
    const handler = this.getCloseTagHandler(name);
    if (handler) {
      handler(state, name, {}, context);
    }
    
    // Clean up current path and element state
    state.currentPath.pop();
    if (state.currentElement?.name === name) {
      state.currentElement = undefined;
    }
  }

  /**
   * Create comprehensive attribute parser with type safety
   */
  protected createAttributeParser(attributes: Readonly<Record<string, string>>): AttributeParser {
    return {
      getInt: (key: string, defaultValue: number = 0): number => {
        const value = attributes[key];
        if (!value) return defaultValue;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
      },

      getFloat: (key: string, defaultValue: number = 0): number => {
        const value = attributes[key];
        if (!value) return defaultValue;
        const parsed = parseFloat(value);
        return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
      },

      getString: (key: string, defaultValue: string = ''): string => {
        const value = attributes[key];
        return value?.trim() || defaultValue;
      },

      getBoolean: (key: string, defaultValue: boolean = false): boolean => {
        const value = attributes[key]?.toLowerCase();
        if (!value) return defaultValue;
        return value === 'true' || value === '1' || value === 'yes';
      },

      getTimestamp: (key: string): string | undefined => {
        const value = attributes[key];
        if (!value) return undefined;
        
        // Validate ISO timestamp format
        const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?$/;
        return timestampRegex.test(value) ? value : undefined;
      },

      hasAttribute: (key: string): boolean => {
        return key in attributes && attributes[key] != null;
      }
    };
  }

  /**
   * Create comprehensive parsing error with context
   */
  private createParsingError(error: unknown, state: MutableParserState): ParsingFailedException {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contextInfo = {
      format: state.format,
      currentPath: state.currentPath.join(' > '),
      elementDepth: state.elementDepth,
      byteCount: state.byteCount,
      processingTimeMs: state.processingTimeMs
    };

    return new ParsingFailedException(
      `XML parsing failed: ${errorMessage}`,
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }

  /**
   * Finalize parsing result with statistics and validation
   */
  protected finalizeResult(state: MutableParserState): TestSuites {
    const { testSuites, warnings } = state;
    
    // Validate test counts consistency
    let totalTests = 0;
    let totalFailures = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    if (testSuites.suites) {
      for (const suite of testSuites.suites) {
        totalTests += suite.tests || 0;
        totalFailures += suite.failures || 0;
        totalErrors += suite.errors || 0;
        totalSkipped += suite.skipped || 0;
      }
    }

    // Use calculated totals if they're more accurate than declared totals
    const finalTests = Math.max(totalTests, testSuites.tests || 0);
    const finalFailures = Math.max(totalFailures, testSuites.failures || 0);
    const finalErrors = Math.max(totalErrors, testSuites.errors || 0);
    const finalSkipped = Math.max(totalSkipped, testSuites.skipped || 0);

    return {
      name: testSuites.name,
      tests: finalTests,
      failures: finalFailures,
      errors: finalErrors,
      skipped: finalSkipped,
      time: testSuites.time,
      timestamp: testSuites.timestamp,
      suites: (testSuites.suites as TestSuite[]) || []
    };
  }

  /**
   * Abstract methods to be implemented by format-specific parsers
   */
  protected abstract getOpenTagHandler(name: string): ElementHandler<T> | null;
  protected abstract getCloseTagHandler(name: string): ElementHandler<T> | null;
  
  /**
   * Public accessor for open tag handlers (for parser composition)
   */
  public getOpenHandler(name: string): ElementHandler<T> | null {
    return this.getOpenTagHandler(name);
  }
  
  /**
   * Public accessor for close tag handlers (for parser composition)
   */
  public getCloseHandler(name: string): ElementHandler<T> | null {
    return this.getCloseTagHandler(name);
  }
}

// ============================================================================
// Surefire Parser (Maven)
// ============================================================================

class SurefireParser extends BaseJUnitParser<'surefire'> {
  constructor(config: ExtractConfig<'surefire'> = {} as SurefireConfig) {
    super('surefire', config);
  }

  protected getOpenTagHandler(name: string): ElementHandler<'surefire'> | null {
    const handlers: Record<string, ElementHandler<'surefire'>> = {
      'testsuites': this.handleTestSuitesOpen,
      'testsuite': this.handleTestSuiteOpen,
      'testcase': this.handleTestCaseOpen,
      'failure': this.handleFailureOpen,
      'error': this.handleErrorOpen,
      'skipped': this.handleSkippedOpen,
      'system-out': this.handleSystemStreamOpen,
      'system-err': this.handleSystemStreamOpen,
      'properties': this.handlePropertiesOpen,
      'property': this.handlePropertyOpen
    };

    return handlers[name] || null;
  }

  protected getCloseTagHandler(name: string): ElementHandler<'surefire'> | null {
    const handlers: Record<string, ElementHandler<'surefire'>> = {
      'testsuite': this.handleTestSuiteClose,
      'testcase': this.handleTestCaseClose,
      'failure': this.handleFailureClose,
      'error': this.handleErrorClose,
      'skipped': this.handleSkippedClose,
      'system-out': this.handleSystemStreamClose,
      'system-err': this.handleSystemStreamClose,
      'properties': this.handlePropertiesClose
    };

    return handlers[name] || null;
  }

  private handleTestSuitesOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    Object.assign(state.testSuites, {
      name: attrs.getString('name'),
      tests: attrs.getInt('tests'),
      failures: attrs.getInt('failures'),
      errors: attrs.getInt('errors'),
      skipped: attrs.getInt('skipped'),
      time: attrs.getFloat('time'),
      timestamp: attrs.getTimestamp('timestamp')
    });
  };

  private handleTestSuiteOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    state.currentSuite = {
      name: attrs.getString('name'),
      id: attrs.getString('id'),
      package: attrs.getString('package'),
      hostname: attrs.getString('hostname'),
      tests: attrs.getInt('tests'),
      failures: attrs.getInt('failures'),
      errors: attrs.getInt('errors'),
      skipped: attrs.getInt('skipped'),
      time: attrs.getFloat('time'),
      timestamp: attrs.getTimestamp('timestamp'),
      testCases: [] as TestCase[],
      properties: {}
    } as TestSuite;
  };

  private handleTestSuiteClose: ElementHandler<'surefire'> = (state) => {
    if (state.currentSuite) {
      (state.testSuites.suites as TestSuite[]).push(state.currentSuite);
      state.currentSuite = undefined;
    }
  };

  private handleTestCaseOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    state.currentTestCase = {
      name: attrs.getString('name'),
      className: attrs.getString('classname') || attrs.getString('class'),
      time: attrs.getFloat('time'),
      status: 'passed' as TestCaseStatus,
      properties: {}
    } as TestCase;
  };

  private handleTestCaseClose: ElementHandler<'surefire'> = (state) => {
    if (state.currentTestCase && state.currentSuite) {
      ((state.currentSuite as any).testCases as TestCase[]).push(state.currentTestCase);
      state.currentTestCase = undefined;
    }
  };

  private handleFailureOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    this.setupFailureElement(state, name, attributes, {
      type: attrs.getString('type'),
      message: attrs.getString('message')
    }, 'failed');
  };

  private handleErrorOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    this.setupFailureElement(state, name, attributes, {
      type: attrs.getString('type'),
      message: attrs.getString('message')
    }, 'error');
  };

  private handleSkippedOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    state.currentElement = { name, attributes: {...attributes}, text: '' };
    
    if (state.currentTestCase) {
      (state.currentTestCase as any).skipped = { message: attrs.getString('message') };
      (state.currentTestCase as any).status = 'skipped';
    }
  };

  private setupFailureElement(
    state: MutableParserState,
    name: string,
    attributes: Readonly<Record<string, string>>,
    failure: TestFailure,
    status: TestCaseStatus
  ): void {
    state.currentElement = { name, attributes: {...attributes}, text: '' };
    
    if (state.currentTestCase) {
      if (name === 'failure') {
        (state.currentTestCase as any).failure = failure;
      } else if (name === 'error') {
        (state.currentTestCase as any).error = failure;
      }
      (state.currentTestCase as any).status = status;
    }
  }

  private handleFailureClose: ElementHandler<'surefire'> = (state) => {
    this.finalizeFailureElement(state, 'failure');
  };

  private handleErrorClose: ElementHandler<'surefire'> = (state) => {
    this.finalizeFailureElement(state, 'error');
  };

  private handleSkippedClose: ElementHandler<'surefire'> = (state) => {
    // Skipped elements don't typically contain stack traces
  };

  private finalizeFailureElement(state: MutableParserState, type: 'failure' | 'error'): void {
    if (state.currentTestCase && state.currentElement) {
      const stackTrace = state.currentElement.text.trim();
      const failureObj = type === 'failure' ? state.currentTestCase.failure : state.currentTestCase.error;
      
      if (failureObj) {
        (failureObj as any).stackTrace = stackTrace;
      }
    }
  }

  private handleSystemStreamOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    state.currentElement = { name, attributes: {...attributes}, text: '' };
  };

  private handleSystemStreamClose: ElementHandler<'surefire'> = (state, name) => {
    if (state.currentElement) {
      const content = state.currentElement.text.trim();
      
      if (state.currentTestCase) {
        if (name === 'system-out') {
          (state.currentTestCase as any).systemOut = content;
        } else if (name === 'system-err') {
          (state.currentTestCase as any).systemErr = content;
        }
      } else if (state.currentSuite) {
        if (name === 'system-out') {
          (state.currentSuite as any).systemOut = content;
        } else if (name === 'system-err') {
          (state.currentSuite as any).systemErr = content;
        }
      }
    }
  };

  private handlePropertiesOpen: ElementHandler<'surefire'> = (state) => {
    // Properties container - no specific action needed
  };

  private handlePropertiesClose: ElementHandler<'surefire'> = (state) => {
    // Properties container closed - no specific action needed
  };

  private handlePropertyOpen: ElementHandler<'surefire'> = (state, name, attributes) => {
    const attrs = this.createAttributeParser(attributes);
    const propName = attrs.getString('name');
    const propValue = attrs.getString('value');
    
    if (propName && state.currentSuite?.properties) {
      (state.currentSuite.properties as Record<string, string>)[propName] = propValue;
    }
  };
}

// ============================================================================
// Gradle Parser with Gradle-specific features
// ============================================================================

class GradleParser extends BaseJUnitParser<'gradle'> {
  private surefireParser = new SurefireParser();
  
  constructor(config: ExtractConfig<'gradle'> = {} as GradleConfig) {
    super('gradle', config);
  }

  protected getOpenTagHandler(name: string): ElementHandler<'gradle'> | null {
    // Gradle uses similar structure to Surefire but with additional attributes
    return this.surefireParser.getOpenHandler(name) as any;
  }

  protected getCloseTagHandler(name: string): ElementHandler<'gradle'> | null {
    return this.surefireParser.getCloseHandler(name) as any;
  }
}

// ============================================================================
// Jest Parser with JavaScript-specific features
// ============================================================================

class JestParser extends BaseJUnitParser<'jest'> {
  private surefireParser = new SurefireParser();
  
  constructor(config: ExtractConfig<'jest'> = {} as JestConfig) {
    super('jest', config);
  }

  protected getOpenTagHandler(name: string): ElementHandler<'jest'> | null {
    // Jest has some unique attributes but follows similar structure
    return this.surefireParser.getOpenHandler(name) as any;
  }

  protected getCloseTagHandler(name: string): ElementHandler<'jest'> | null {
    return this.surefireParser.getCloseHandler(name) as any;
  }
}

// ============================================================================
// Pytest Parser with Python-specific features
// ============================================================================

class PytestParser extends BaseJUnitParser<'pytest'> {
  private surefireParser = new SurefireParser();
  
  constructor(config: ExtractConfig<'pytest'> = {} as PytestConfig) {
    super('pytest', config);
  }

  protected getOpenTagHandler(name: string): ElementHandler<'pytest'> | null {
    return this.surefireParser.getOpenHandler(name) as any;
  }

  protected getCloseTagHandler(name: string): ElementHandler<'pytest'> | null {
    return this.surefireParser.getCloseHandler(name) as any;
  }
}

// ============================================================================
// PHPUnit Parser with PHP-specific features
// ============================================================================

class PHPUnitParser extends BaseJUnitParser<'phpunit'> {
  private surefireParser = new SurefireParser();
  
  constructor(config: ExtractConfig<'phpunit'> = {} as PHPUnitConfig) {
    super('phpunit', config);
  }

  protected getOpenTagHandler(name: string): ElementHandler<'phpunit'> | null {
    return this.surefireParser.getOpenHandler(name) as any;
  }

  protected getCloseTagHandler(name: string): ElementHandler<'phpunit'> | null {
    return this.surefireParser.getCloseHandler(name) as any;
  }
}

// ============================================================================
// Generic Parser for unknown formats
// ============================================================================

class GenericParser extends BaseJUnitParser<'generic'> {
  private surefireParser = new SurefireParser();
  
  constructor(config: ExtractConfig<'generic'> = {} as GenericConfig) {
    super('generic', config);
  }

  protected getOpenTagHandler(name: string): ElementHandler<'generic'> | null {
    return this.surefireParser.getOpenHandler(name) as any;
  }

  protected getCloseTagHandler(name: string): ElementHandler<'generic'> | null {
    return this.surefireParser.getCloseHandler(name) as any;
  }

  protected finalizeResult(state: MutableParserState): TestSuites {
    // Add warning for generic parser usage
    state.warnings.push('Used generic parser - some format-specific features may not be available');
    return super.finalizeResult(state);
  }
}

// ============================================================================
// Parser Factory with Advanced Type Safety
// ============================================================================

/**
 * Create appropriate parser based on format with strict typing
 */
export function createJUnitParser<T extends JUnitFormat>(
  format: T,
  config?: ExtractConfig<T>,
  options?: StreamProcessingOptions
): BaseJUnitParser<T> {
  const defaultOptions: StreamProcessingOptions = {
    highWaterMark: 50 * 1024 * 1024, // 50MB
    objectMode: false,
    encoding: 'utf8'
  };

  const mergedOptions = { ...defaultOptions, ...options };

  switch (format) {
    case 'surefire':
      return new SurefireParser(config as ExtractConfig<'surefire'>) as any;
    case 'gradle':
      return new GradleParser(config as ExtractConfig<'gradle'>) as any;
    case 'jest':
      return new JestParser(config as ExtractConfig<'jest'>) as any;
    case 'pytest':
      return new PytestParser(config as ExtractConfig<'pytest'>) as any;
    case 'phpunit':
      return new PHPUnitParser(config as ExtractConfig<'phpunit'>) as any;
    case 'generic':
    default:
      return new GenericParser(config as ExtractConfig<'generic'>) as any;
  }
}

// ============================================================================
// Advanced Format Detection
// ============================================================================

/**
 * Detect JUnit format from XML content with improved accuracy
 */
export async function detectJUnitFormat(
  stream: Readable,
  fileName?: string
): Promise<FormatDetectionResult> {
  let format: JUnitFormat = 'generic';
  let confidence = 0.1;
  const indicators: string[] = [];

  // Start with path-based detection
  if (fileName) {
    const pathFormat = detectFormatFromPath(fileName);
    if (pathFormat !== 'generic') {
      format = pathFormat;
      confidence = 0.6;
      indicators.push(`filename pattern: ${fileName}`);
    }
  }

  // Content-based detection with streaming
  return new Promise((resolve) => {
    let contentBuffer = '';
    let hasAnalyzed = false;

    const analyzeContent = () => {
      if (hasAnalyzed) return;
      hasAnalyzed = true;

      const contentResult = analyzeXMLContent(contentBuffer);
      if (contentResult.confidence > confidence) {
        format = contentResult.format;
        confidence = contentResult.confidence;
        indicators.push(...contentResult.indicators);
      }

      resolve({ format, confidence, indicators });
    };

    stream.on('data', (chunk: Buffer) => {
      if (!hasAnalyzed) {
        contentBuffer += chunk.toString();
        
        // Analyze after collecting enough content or reaching a reasonable size
        if (contentBuffer.length >= 4096 || contentBuffer.includes('</testsuite>')) {
          analyzeContent();
        }
      }
    });

    stream.on('end', analyzeContent);
    stream.on('error', () => {
      resolve({ format, confidence, indicators });
    });

    // Timeout for detection
    setTimeout(analyzeContent, 1000);
  });
}

/**
 * Enhanced content analysis with multiple detection heuristics
 */
function analyzeXMLContent(content: string): FormatDetectionResult {
  const lowerContent = content.toLowerCase();
  let format: JUnitFormat = 'generic';
  let confidence = 0.1;
  const indicators: string[] = [];

  // Surefire indicators
  const surefireIndicators = [
    'surefire', 'maven', 'target/surefire-reports',
    'com.sun.management', 'java.runtime.name'
  ];
  const surefireScore = surefireIndicators.reduce((score, indicator) => {
    return score + (lowerContent.includes(indicator) ? 0.2 : 0);
  }, 0);

  if (surefireScore > 0.4) {
    format = 'surefire';
    confidence = Math.min(0.9, 0.5 + surefireScore);
    indicators.push('surefire keywords detected');
  }

  // Gradle indicators
  const gradleIndicators = [
    'gradle', 'test executor', 'build/test-results',
    'gradle.version', 'kotlin'
  ];
  const gradleScore = gradleIndicators.reduce((score, indicator) => {
    return score + (lowerContent.includes(indicator) ? 0.2 : 0);
  }, 0);

  if (gradleScore > confidence && gradleScore > 0.3) {
    format = 'gradle';
    confidence = Math.min(0.9, 0.5 + gradleScore);
    indicators.push('gradle keywords detected');
  }

  // Jest indicators
  const jestIndicators = [
    'jest', 'facebook', '.spec.js', '.test.js',
    'node_modules/jest'
  ];
  const jestScore = jestIndicators.reduce((score, indicator) => {
    return score + (lowerContent.includes(indicator) ? 0.25 : 0);
  }, 0);

  if (jestScore > confidence && jestScore > 0.3) {
    format = 'jest';
    confidence = Math.min(0.9, 0.5 + jestScore);
    indicators.push('jest keywords detected');
  }

  // Pytest indicators
  const pytestIndicators = [
    'pytest', 'python', '.py::', 'conftest',
    'test_*.py'
  ];
  const pytestScore = pytestIndicators.reduce((score, indicator) => {
    return score + (lowerContent.includes(indicator) ? 0.25 : 0);
  }, 0);

  if (pytestScore > confidence && pytestScore > 0.3) {
    format = 'pytest';
    confidence = Math.min(0.8, 0.4 + pytestScore);
    indicators.push('pytest keywords detected');
  }

  // PHPUnit indicators
  const phpunitIndicators = [
    'phpunit', 'php', 'vendor/phpunit',
    '::test', '.php'
  ];
  const phpunitScore = phpunitIndicators.reduce((score, indicator) => {
    return score + (lowerContent.includes(indicator) ? 0.25 : 0);
  }, 0);

  if (phpunitScore > confidence && phpunitScore > 0.3) {
    format = 'phpunit';
    confidence = Math.min(0.8, 0.4 + phpunitScore);
    indicators.push('phpunit keywords detected');
  }

  return { format, confidence, indicators };
}

// ============================================================================
// Main Parse Functions with Enhanced Error Handling
// ============================================================================

/**
 * Extract JUnitTestCase objects from TestSuites with comprehensive metadata
 */
export function extractJUnitTestCases(testSuites: TestSuites): JUnitTestCase[] {
  const testCases: JUnitTestCase[] = [];
  
  if (!testSuites.suites) {
    return testCases;
  }

  for (const suite of testSuites.suites) {
    const suiteName = suite.name || 'Unknown Suite';
    
    if (!suite.testCases) {
      continue;
    }

    for (const testCase of suite.testCases) {
      const junitTestCase: JUnitTestCase = {
        suite: suiteName,
        class: testCase.className,
        name: testCase.name,
        time: testCase.time || 0,
        status: testCase.status as 'passed' | 'failed' | 'error' | 'skipped',
      };

      // Add failure/error details
      if (testCase.failure) {
        junitTestCase.message = testCase.failure.message;
        junitTestCase.stack = testCase.failure.stackTrace;
      } else if (testCase.error) {
        junitTestCase.message = testCase.error.message;
        junitTestCase.stack = testCase.error.stackTrace;
      }

      // Extract file path from className or properties
      if (testCase.className) {
        // Try to extract file path from class name patterns
        const classNamePatterns = [
          // Java: com.example.TestClass -> src/main/java/com/example/TestClass.java
          /^([a-zA-Z_][\w.]+)\.([A-Z]\w*)$/,
          // Python: test_module.py::TestClass::test_method
          /^(.+)\.py::(.+)$/,
          // JavaScript: path/to/test.spec.js
          /^(.+\.(js|ts|jsx|tsx))$/,
          // C#: Namespace.TestClass
          /^([A-Z]\w*(?:\.[A-Z]\w*)*)\.([A-Z]\w*)$/
        ];

        for (const pattern of classNamePatterns) {
          const match = testCase.className.match(pattern);
          if (match) {
            junitTestCase.file = match[1] || testCase.className;
            break;
          }
        }
      }

      // Check test case properties for file information
      if (!junitTestCase.file && testCase.properties) {
        const fileProps = ['file', 'filename', 'source', 'path', 'location'];
        for (const prop of fileProps) {
          if (testCase.properties[prop]) {
            junitTestCase.file = String(testCase.properties[prop]);
            break;
          }
        }
      }

      testCases.push(junitTestCase);
    }
  }

  return testCases;
}

/**
 * Advanced parse function returning comprehensive results with format-specific metadata
 */
export async function parseJUnitXMLAdvanced<T extends JUnitFormat = JUnitFormat>(
  stream: Readable,
  options: {
    fileName?: string;
    expectedFormat?: T;
    formatConfig?: ExtractConfig<T>;
    streamOptions?: StreamProcessingOptions;
    validateResult?: boolean;
    extractTestCases?: boolean;
  } = {}
): Promise<JUnitParseResult<T>> {
  const { extractTestCases = true, ...baseOptions } = options;
  const parseResult = await parseJUnitXML(stream, baseOptions);
  
  const testCases = extractTestCases ? extractJUnitTestCases(parseResult.testSuites) : [];
  
  // Create format-specific metadata
  const metadata = createFormatSpecificMetadata(parseResult.format, parseResult.testSuites);
  
  return {
    testSuites: parseResult.testSuites,
    testCases: testCases as TransformTestCase<JUnitTestCase>[],
    format: parseResult.format,
    metadata,
    processingStats: {
      bytesParsed: parseResult.byteCount,
      elementsProcessed: (parseResult as { elementsProcessed?: number }).elementsProcessed || 0,
      parsingTimeMs: parseResult.processingTimeMs,
      memoryPeakMB: (parseResult as { memoryPeakMB?: number }).memoryPeakMB || 0,
    },
    warnings: parseResult.warnings,
  };
}

/**
 * Create format-specific metadata based on test suites content
 */
function createFormatSpecificMetadata<T extends JUnitFormat>(
  format: T,
  testSuites: TestSuites
): FormatSpecificResult<T> {
  const baseMetadata = {
    format,
    totalTests: testSuites.tests,
    totalFailures: testSuites.failures,
    totalErrors: testSuites.errors,
    totalSkipped: testSuites.skipped,
    executionTime: testSuites.time,
    timestamp: testSuites.timestamp,
  };

  switch (format) {
    case 'surefire':
      return {
        surefireSpecific: {
          mavenVersion: extractPropertyFromSuites(testSuites, 'maven.version'),
          testClassLoader: extractPropertyFromSuites(testSuites, 'sun.java.launcher'),
        },
      } as FormatSpecificResult<T>;
      
    case 'gradle':
      return {
        gradleSpecific: {
          taskName: extractPropertyFromSuites(testSuites, 'gradle.task.name'),
          gradleVersion: extractPropertyFromSuites(testSuites, 'gradle.version'),
        },
      } as FormatSpecificResult<T>;
      
    case 'jest':
      return {
        jestSpecific: {
          jestVersion: extractPropertyFromSuites(testSuites, 'jest.version'),
          coverageData: extractPropertyFromSuites(testSuites, 'coverage.data'),
        },
      } as FormatSpecificResult<T>;
      
    case 'pytest':
      return {
        pytestSpecific: {
          pythonVersion: extractPropertyFromSuites(testSuites, 'python.version'),
          fixtures: extractFixturesFromSuites(testSuites),
        },
      } as FormatSpecificResult<T>;
      
    case 'phpunit':
      return {
        phpunitSpecific: {
          phpVersion: extractPropertyFromSuites(testSuites, 'php.version'),
          coverageFormat: extractPropertyFromSuites(testSuites, 'coverage.format'),
        },
      } as FormatSpecificResult<T>;
      
    default:
      return {
        genericData: baseMetadata,
      } as any;
  }
}

/**
 * Extract property value from test suites properties
 */
function extractPropertyFromSuites(testSuites: TestSuites, propertyName: string): string | undefined {
  if (!testSuites.suites) return undefined;
  
  for (const suite of testSuites.suites) {
    if (suite.properties && suite.properties[propertyName]) {
      return String(suite.properties[propertyName]);
    }
  }
  return undefined;
}

/**
 * Extract fixture information from pytest suites
 */
function extractFixturesFromSuites(testSuites: TestSuites): string[] {
  const fixtures: string[] = [];
  
  if (!testSuites.suites) return fixtures;
  
  for (const suite of testSuites.suites) {
    if (!suite.testCases) continue;
    
    for (const testCase of suite.testCases) {
      if (testCase.properties) {
        const fixtureProps = Object.keys(testCase.properties)
          .filter(key => key.startsWith('fixture.') || key.includes('fixture'))
          .map(key => String(testCase.properties![key]));
        fixtures.push(...fixtureProps);
      }
    }
  }
  
  return Array.from(new Set(fixtures)); // Remove duplicates
}

/**
 * Parse JUnit XML from stream with automatic format detection and validation
 */
export async function parseJUnitXML<T extends JUnitFormat = JUnitFormat>(
  stream: Readable,
  options: {
    fileName?: string;
    expectedFormat?: T;
    formatConfig?: ExtractConfig<T>;
    streamOptions?: StreamProcessingOptions;
    validateResult?: boolean;
  } = {}
): Promise<{ 
  testSuites: TestSuites; 
  format: T; 
  warnings: readonly string[];
  processingTimeMs: number;
  byteCount: number;
}> {
  const startTime = Date.now();
  const { fileName, expectedFormat, formatConfig, streamOptions, validateResult = true } = options;

  try {
    // Detect format if not specified
    let format = expectedFormat;
    if (!format) {
      const detection = await detectJUnitFormat(stream, fileName);
      format = detection.format as T;
    }

    // Create appropriate parser
    const parser = createJUnitParser(format, formatConfig, streamOptions);

    // Parse the XML
    const testSuites = await parser.parseFromStream(stream);
    
    // Validate result if requested
    if (validateResult) {
      validateTestSuitesStructure(testSuites);
    }

    const processingTimeMs = Date.now() - startTime;
    
    return {
      testSuites,
      format,
      warnings: [],
      processingTimeMs,
      byteCount: 0 // This would be populated by the parser
    };
    
  } catch (error) {
    throw new ParsingFailedException(
      `Failed to parse JUnit XML: ${error instanceof Error ? error.message : String(error)}`,
      fileName,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Validate test suites structure for consistency
 */
function validateTestSuitesStructure(testSuites: TestSuites): void {
  if (testSuites.tests < 0 || testSuites.failures < 0 || testSuites.errors < 0 || testSuites.skipped < 0) {
    throw new Error('Test counts cannot be negative');
  }

  if (testSuites.failures + testSuites.errors + testSuites.skipped > testSuites.tests) {
    throw new Error('Sum of failures, errors, and skipped tests cannot exceed total tests');
  }

  for (const suite of testSuites.suites) {
    if (suite.tests < 0 || suite.failures < 0 || suite.errors < 0 || suite.skipped < 0) {
      throw new Error(`Test suite "${suite.name}" has negative test counts`);
    }

    if (suite.testCases.length !== suite.tests && suite.tests > 0) {
      // This is a warning rather than an error as some formats may not be precise
      console.warn(`Test suite "${suite.name}" reports ${suite.tests} tests but contains ${suite.testCases.length} test cases`);
    }
  }
}

/**
 * Parse JUnit XML from file path with comprehensive error handling
 */
export async function parseJUnitXMLFile<T extends JUnitFormat = JUnitFormat>(
  filePath: string,
  options: {
    expectedFormat?: T;
    formatConfig?: ExtractConfig<T>;
    streamOptions?: StreamProcessingOptions;
    validateResult?: boolean;
  } = {}
): Promise<{ 
  testSuites: TestSuites; 
  format: T; 
  warnings: readonly string[];
  processingTimeMs: number;
  byteCount: number;
}> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const fileName = filePath.split(/[/\\]/).pop();
  
  return parseJUnitXML(stream, {
    fileName,
    ...options
  });
}

/**
 * Parse JUnit XML from string content with memory efficiency considerations
 */
export async function parseJUnitXMLString<T extends JUnitFormat = JUnitFormat>(
  xmlContent: string,
  options: {
    fileName?: string;
    expectedFormat?: T;
    formatConfig?: ExtractConfig<T>;
    validateResult?: boolean;
  } = {}
): Promise<{ 
  testSuites: TestSuites; 
  format: T; 
  warnings: readonly string[];
  processingTimeMs: number;
  byteCount: number;
}> {
  const stream = new Readable({
    read() {
      this.push(xmlContent);
      this.push(null);
    }
  });

  return parseJUnitXML(stream, {
    streamOptions: { 
      highWaterMark: Math.max(16384, xmlContent.length * 2),
      encoding: 'utf8'
    },
    ...options
  });
}

// Export types for external use
export type {
  // Core interfaces
  JUnitTestCase,
  
  // Advanced utility types
  DeepReadonly,
  KeysWithValueType,
  FormatSpecificResult,
  TransformTestCase,
  JUnitParseResult,
  
  // Configuration types
  ExtractConfig,
  ParsingContext,
  AttributeParser,
  SurefireConfig,
  GradleConfig,
  JestConfig,
  PytestConfig,
  PHPUnitConfig,
  GenericConfig,
  
  // Parser types
  BaseJUnitParser,
};