/**
 * Advanced JUnit XML streaming parser with format-specific support
 * Uses SAX parsing for memory efficiency and supports multiple JUnit formats
 */
import type { Readable } from 'stream';
import type { TestCase, TestSuite, TestSuites, JUnitFormat, FormatDetectionResult, FormatSpecificConfig } from '../types.js';
/**
 * Mutable parser state for internal use
 */
interface MutableParserState {
    format: JUnitFormat;
    currentPath: string[];
    testSuites: Partial<TestSuites>;
    currentSuite?: Partial<TestSuite>;
    currentTestCase?: Partial<TestCase>;
    currentElement?: {
        name: string;
        attributes: Record<string, string>;
        text: string;
    };
    warnings: string[];
}
/**
 * Element handler function type
 */
type ElementHandler = (state: MutableParserState, name: string, attributes: Record<string, string>) => void;
/**
 * Close element handler function type
 */
type CloseHandler = (state: MutableParserState, name: string) => void;
/**
 * Abstract base parser class with common functionality
 */
declare abstract class BaseJUnitParser {
    protected readonly format: JUnitFormat;
    protected readonly config: FormatSpecificConfig<JUnitFormat>;
    constructor(format: JUnitFormat, config?: FormatSpecificConfig<JUnitFormat>);
    /**
     * Parse XML content from stream
     */
    parseFromStream(stream: Readable): Promise<TestSuites>;
    /**
     * Create SAX parser using real sax library
     */
    private createSaxParser;
    /**
     * Handle opening XML tag
     */
    protected handleOpenTag(state: MutableParserState, name: string, attributes: Record<string, string>): void;
    /**
     * Handle text content
     */
    protected handleText(state: MutableParserState, text: string): void;
    /**
     * Handle closing XML tag
     */
    protected handleCloseTag(state: MutableParserState, name: string): void;
    /**
     * Get handler for opening tag
     */
    protected abstract getOpenTagHandler(name: string): ElementHandler | null;
    /**
     * Get handler for closing tag
     */
    protected abstract getCloseTagHandler(name: string): CloseHandler | null;
    /**
     * Finalize parsing result
     */
    protected finalizeResult(state: MutableParserState): TestSuites;
    /**
     * Parse attributes with type conversion
     */
    protected parseAttributes(attributes: Record<string, string>): {
        getInt: (key: string, defaultValue?: number) => number;
        getFloat: (key: string, defaultValue?: number) => number;
        getString: (key: string, defaultValue?: string) => string;
        getBoolean: (key: string, defaultValue?: boolean) => boolean;
    };
}
/**
 * Create appropriate parser based on format
 */
export declare function createJUnitParser<T extends JUnitFormat>(format: T, config?: FormatSpecificConfig<T>): BaseJUnitParser;
/**
 * Detect JUnit format from XML content
 */
export declare function detectJUnitFormat(stream: Readable, fileName?: string): Promise<FormatDetectionResult>;
/**
 * Parse JUnit XML from stream with automatic format detection
 */
export declare function parseJUnitXML(stream: Readable, options?: {
    fileName?: string;
    expectedFormat?: JUnitFormat;
    formatConfig?: FormatSpecificConfig<JUnitFormat>;
}): Promise<{
    testSuites: TestSuites;
    format: JUnitFormat;
    warnings: string[];
}>;
/**
 * Parse JUnit XML from file path
 */
export declare function parseJUnitXMLFile(filePath: string, options?: {
    expectedFormat?: JUnitFormat;
    formatConfig?: FormatSpecificConfig<JUnitFormat>;
}): Promise<{
    testSuites: TestSuites;
    format: JUnitFormat;
    warnings: string[];
}>;
/**
 * Parse JUnit XML from string content
 */
export declare function parseJUnitXMLString(xmlContent: string, options?: {
    fileName?: string;
    expectedFormat?: JUnitFormat;
    formatConfig?: FormatSpecificConfig<JUnitFormat>;
}): Promise<{
    testSuites: TestSuites;
    format: JUnitFormat;
    warnings: string[];
}>;
export {};
//# sourceMappingURL=junit-parser.d.ts.map