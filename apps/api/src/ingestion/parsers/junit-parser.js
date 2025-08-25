/**
 * Advanced JUnit XML streaming parser with format-specific support
 * Uses SAX parsing for memory efficiency and supports multiple JUnit formats
 */
import { createReadStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import * as sax from 'sax';
import { detectFormatFromPath } from '../utils.js';
const pipelineAsync = promisify(pipeline);
// ============================================================================
// Format-Specific Parsers
// ============================================================================
/**
 * Abstract base parser class with common functionality
 */
class BaseJUnitParser {
    format;
    config;
    constructor(format, config = {}) {
        this.format = format;
        this.config = config;
    }
    /**
     * Parse XML content from stream
     */
    async parseFromStream(stream) {
        return new Promise((resolve, reject) => {
            const state = {
                format: this.format,
                currentPath: [],
                testSuites: {
                    tests: 0,
                    failures: 0,
                    errors: 0,
                    skipped: 0,
                    suites: []
                },
                warnings: []
            };
            // Real SAX parser implementation
            const parser = this.createSaxParser();
            parser.on('opentag', (node) => {
                this.handleOpenTag(state, node.name, node.attributes);
            });
            parser.on('text', (text) => {
                this.handleText(state, text.trim());
            });
            parser.on('closetag', (name) => {
                this.handleCloseTag(state, name);
            });
            parser.on('error', (error) => {
                reject(new ParsingFailedException(`XML parsing failed: ${error.message}`, undefined, error));
            });
            parser.on('end', () => {
                try {
                    const result = this.finalizeResult(state);
                    resolve(result);
                }
                catch (error) {
                    reject(error);
                }
            });
            // Pipe stream through parser
            stream.pipe(parser);
            stream.on('error', (error) => {
                reject(new ParsingFailedException(`Stream error: ${error.message}`, undefined, error));
            });
        });
    }
    /**
     * Create SAX parser using real sax library
     */
    createSaxParser() {
        return sax.createStream(true, {
            lowercase: true,
            normalize: true,
            trim: false
        });
    }
    /**
     * Handle opening XML tag
     */
    handleOpenTag(state, name, attributes) {
        state.currentPath.push(name);
        const handler = this.getOpenTagHandler(name);
        if (handler) {
            handler(state, name, attributes);
        }
    }
    /**
     * Handle text content
     */
    handleText(state, text) {
        if (text && state.currentElement) {
            state.currentElement.text += text;
        }
    }
    /**
     * Handle closing XML tag
     */
    handleCloseTag(state, name) {
        const handler = this.getCloseTagHandler(name);
        if (handler) {
            handler(state, name);
        }
        state.currentPath.pop();
        if (state.currentElement?.name === name) {
            state.currentElement = undefined;
        }
    }
    /**
     * Finalize parsing result
     */
    finalizeResult(state) {
        const { testSuites, warnings } = state;
        return {
            name: testSuites.name,
            tests: testSuites.tests || 0,
            failures: testSuites.failures || 0,
            errors: testSuites.errors || 0,
            skipped: testSuites.skipped || 0,
            time: testSuites.time,
            timestamp: testSuites.timestamp,
            suites: testSuites.suites || []
        };
    }
    /**
     * Parse attributes with type conversion
     */
    parseAttributes(attributes) {
        return {
            getInt: (key, defaultValue = 0) => {
                const value = attributes[key];
                return value ? parseInt(value, 10) || defaultValue : defaultValue;
            },
            getFloat: (key, defaultValue = 0) => {
                const value = attributes[key];
                return value ? parseFloat(value) || defaultValue : defaultValue;
            },
            getString: (key, defaultValue = '') => {
                return attributes[key] || defaultValue;
            },
            getBoolean: (key, defaultValue = false) => {
                const value = attributes[key]?.toLowerCase();
                return value === 'true' || value === '1' || defaultValue;
            }
        };
    }
}
// ============================================================================
// Surefire Parser (Maven)
// ============================================================================
class SurefireParser extends BaseJUnitParser {
    constructor(config = {}) {
        super('surefire', config);
    }
    getOpenTagHandler(name) {
        switch (name) {
            case 'testsuites':
                return this.handleTestSuitesOpen;
            case 'testsuite':
                return this.handleTestSuiteOpen;
            case 'testcase':
                return this.handleTestCaseOpen;
            case 'failure':
            case 'error':
            case 'skipped':
                return this.handleFailureOpen;
            case 'system-out':
            case 'system-err':
                return this.handleSystemStreamOpen;
            default:
                return null;
        }
    }
    getCloseTagHandler(name) {
        switch (name) {
            case 'testsuite':
                return this.handleTestSuiteClose;
            case 'testcase':
                return this.handleTestCaseClose;
            case 'failure':
            case 'error':
            case 'skipped':
                return this.handleFailureClose;
            case 'system-out':
            case 'system-err':
                return this.handleSystemStreamClose;
            default:
                return null;
        }
    }
    handleTestSuitesOpen = (state, name, attributes) => {
        const attrs = this.parseAttributes(attributes);
        state.testSuites.name = attrs.getString('name');
        state.testSuites.tests = attrs.getInt('tests');
        state.testSuites.failures = attrs.getInt('failures');
        state.testSuites.errors = attrs.getInt('errors');
        state.testSuites.skipped = attrs.getInt('skipped');
        state.testSuites.time = attrs.getFloat('time');
        state.testSuites.timestamp = attrs.getString('timestamp');
    };
    handleTestSuiteOpen = (state, name, attributes) => {
        const attrs = this.parseAttributes(attributes);
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
            timestamp: attrs.getString('timestamp'),
            testCases: [],
            properties: {}
        };
    };
    handleTestSuiteClose = (state) => {
        if (state.currentSuite && state.testSuites.suites) {
            state.testSuites.suites.push(state.currentSuite);
            state.currentSuite = undefined;
        }
    };
    handleTestCaseOpen = (state, name, attributes) => {
        const attrs = this.parseAttributes(attributes);
        state.currentTestCase = {
            name: attrs.getString('name'),
            className: attrs.getString('classname') || attrs.getString('class'),
            time: attrs.getFloat('time'),
            status: 'passed',
            properties: {}
        };
    };
    handleTestCaseClose = (state) => {
        if (state.currentTestCase && state.currentSuite?.testCases) {
            state.currentSuite.testCases.push(state.currentTestCase);
            state.currentTestCase = undefined;
        }
    };
    handleFailureOpen = (state, name, attributes) => {
        const attrs = this.parseAttributes(attributes);
        state.currentElement = {
            name,
            attributes,
            text: ''
        };
        if (state.currentTestCase) {
            const failure = {
                type: attrs.getString('type'),
                message: attrs.getString('message')
            };
            if (name === 'failure') {
                state.currentTestCase.failure = failure;
                state.currentTestCase.status = 'failed';
            }
            else if (name === 'error') {
                state.currentTestCase.error = failure;
                state.currentTestCase.status = 'error';
            }
            else if (name === 'skipped') {
                state.currentTestCase.skipped = { message: attrs.getString('message') };
                state.currentTestCase.status = 'skipped';
            }
        }
    };
    handleFailureClose = (state, name) => {
        if (state.currentTestCase && state.currentElement) {
            const stackTrace = state.currentElement.text;
            if (name === 'failure' && state.currentTestCase.failure) {
                state.currentTestCase.failure.stackTrace = stackTrace;
            }
            else if (name === 'error' && state.currentTestCase.error) {
                state.currentTestCase.error.stackTrace = stackTrace;
            }
        }
    };
    handleSystemStreamOpen = (state, name, attributes) => {
        state.currentElement = { name, attributes, text: '' };
    };
    handleSystemStreamClose = (state, name) => {
        if (state.currentElement) {
            const content = state.currentElement.text;
            if (state.currentTestCase) {
                if (name === 'system-out') {
                    state.currentTestCase.systemOut = content;
                }
                else if (name === 'system-err') {
                    state.currentTestCase.systemErr = content;
                }
            }
            else if (state.currentSuite) {
                if (name === 'system-out') {
                    state.currentSuite.systemOut = content;
                }
                else if (name === 'system-err') {
                    state.currentSuite.systemErr = content;
                }
            }
        }
    };
}
// ============================================================================
// Gradle Parser
// ============================================================================
class GradleParser extends BaseJUnitParser {
    constructor(config = {}) {
        super('gradle', config);
    }
    getOpenTagHandler(name) {
        // Gradle uses similar structure to Surefire but with some differences
        return new SurefireParser().getOpenTagHandler(name);
    }
    getCloseTagHandler(name) {
        return new SurefireParser().getCloseTagHandler(name);
    }
}
// ============================================================================
// Jest Parser
// ============================================================================
class JestParser extends BaseJUnitParser {
    constructor(config = {}) {
        super('jest', config);
    }
    getOpenTagHandler(name) {
        // Jest has its own quirks in XML structure
        switch (name) {
            case 'testsuites':
            case 'testsuite':
            case 'testcase':
                return new SurefireParser().getOpenTagHandler(name);
            default:
                return null;
        }
    }
    getCloseTagHandler(name) {
        return new SurefireParser().getCloseTagHandler(name);
    }
}
// ============================================================================
// Generic Parser
// ============================================================================
class GenericParser extends SurefireParser {
    constructor(config = {}) {
        super(config); // Generic config
    }
    finalizeResult(state) {
        // Add warnings for generic parser
        state.warnings.push('Used generic parser - some format-specific features may not be available');
        return super.finalizeResult(state);
    }
}
// ============================================================================
// Parser Factory
// ============================================================================
/**
 * Create appropriate parser based on format
 */
export function createJUnitParser(format, config) {
    switch (format) {
        case 'surefire':
            return new SurefireParser(config);
        case 'gradle':
            return new GradleParser(config);
        case 'jest':
            return new JestParser(config);
        case 'pytest':
        case 'phpunit':
            // Use Surefire parser as base for now
            return new SurefireParser(config);
        case 'generic':
        default:
            return new GenericParser(config);
    }
}
// ============================================================================
// Format Detection
// ============================================================================
/**
 * Detect JUnit format from XML content
 */
export async function detectJUnitFormat(stream, fileName) {
    let format = 'generic';
    let confidence = 0.1;
    const indicators = [];
    // Start with path-based detection
    if (fileName) {
        format = detectFormatFromPath(fileName);
        if (format !== 'generic') {
            confidence = 0.6;
            indicators.push(`filename: ${fileName}`);
        }
    }
    // Read first chunk to analyze content
    return new Promise((resolve) => {
        let firstChunk = '';
        let hasRead = false;
        const onData = (chunk) => {
            if (!hasRead) {
                firstChunk = chunk.toString().substring(0, 2048);
                hasRead = true;
                stream.off('data', onData);
                // Analyze content for format indicators
                const contentResult = analyzeXMLContent(firstChunk);
                if (contentResult.confidence > confidence) {
                    format = contentResult.format;
                    confidence = contentResult.confidence;
                    indicators.push(...contentResult.indicators);
                }
                resolve({ format, confidence, indicators });
            }
        };
        const onError = () => {
            resolve({ format, confidence, indicators });
        };
        stream.on('data', onData);
        stream.on('error', onError);
        stream.on('end', () => {
            if (!hasRead) {
                resolve({ format, confidence, indicators });
            }
        });
    });
}
/**
 * Analyze XML content for format-specific indicators
 */
function analyzeXMLContent(content) {
    const lowerContent = content.toLowerCase();
    let format = 'generic';
    let confidence = 0.1;
    const indicators = [];
    // Check for Surefire indicators
    if (lowerContent.includes('surefire') || lowerContent.includes('maven')) {
        format = 'surefire';
        confidence = 0.9;
        indicators.push('surefire keywords');
    }
    // Check for Gradle indicators
    else if (lowerContent.includes('gradle') || lowerContent.includes('test executor')) {
        format = 'gradle';
        confidence = 0.8;
        indicators.push('gradle keywords');
    }
    // Check for Jest indicators
    else if (lowerContent.includes('jest') || lowerContent.includes('facebook')) {
        format = 'jest';
        confidence = 0.8;
        indicators.push('jest keywords');
    }
    // Check for Pytest indicators
    else if (lowerContent.includes('pytest') || lowerContent.includes('python')) {
        format = 'pytest';
        confidence = 0.7;
        indicators.push('pytest keywords');
    }
    // Check for PHPUnit indicators
    else if (lowerContent.includes('phpunit') || lowerContent.includes('php')) {
        format = 'phpunit';
        confidence = 0.7;
        indicators.push('phpunit keywords');
    }
    return { format, confidence, indicators };
}
// ============================================================================
// Main Parse Function
// ============================================================================
/**
 * Parse JUnit XML from stream with automatic format detection
 */
export async function parseJUnitXML(stream, options = {}) {
    const { fileName, expectedFormat, formatConfig } = options;
    // Detect format if not specified
    let format = expectedFormat;
    if (!format) {
        const detection = await detectJUnitFormat(stream, fileName);
        format = detection.format;
    }
    // Create appropriate parser
    const parser = createJUnitParser(format, formatConfig);
    try {
        // Parse the XML
        const testSuites = await parser.parseFromStream(stream);
        return {
            testSuites,
            format,
            warnings: []
        };
    }
    catch (error) {
        throw new ParsingFailedException(`Failed to parse JUnit XML: ${error instanceof Error ? error.message : String(error)}`, fileName, error instanceof Error ? error : new Error(String(error)));
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Parse JUnit XML from file path
 */
export async function parseJUnitXMLFile(filePath, options = {}) {
    const stream = createReadStream(filePath);
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
    return parseJUnitXML(stream, {
        fileName,
        ...options
    });
}
/**
 * Parse JUnit XML from string content
 */
export async function parseJUnitXMLString(xmlContent, options = {}) {
    const { Readable } = await import('stream');
    const stream = new Readable({
        read() {
            this.push(xmlContent);
            this.push(null);
        }
    });
    return parseJUnitXML(stream, options);
}
//# sourceMappingURL=junit-parser.js.map