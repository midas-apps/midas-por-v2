/**
 * Structured text utilities for object claims
 *
 * Structured text is plain text that can be referenced via line/char pointers.
 */
/**
 * Extract a value from structured text using a pointer.
 *
 * Pointer formats:
 * - "line:3" - Get entire line 3
 * - "char:11-20" - Get characters 11-20
 * - "lines:1-3" - Get lines 1-3
 *
 * @param text - Plain text string
 * @param pointer - Pointer in format "line:N", "char:START-END", or "lines:START-END"
 * @returns The extracted string
 */
export function extractFromStructuredText(text, pointer) {
    const [pointerType, pointerValue] = pointer.split(':');
    switch (pointerType) {
        case 'line': {
            const lineNum = parseInt(pointerValue, 10);
            const lines = text.split('\n');
            if (lineNum < 1 || lineNum > lines.length) {
                throw new Error(`Line ${lineNum} out of range (1-${lines.length})`);
            }
            return lines[lineNum - 1];
        }
        case 'char': {
            const [start, end] = pointerValue.split('-').map(s => parseInt(s, 10));
            if (start < 0 || end > text.length) {
                throw new Error(`Character range ${start}-${end} out of bounds (text length: ${text.length})`);
            }
            return text.substring(start, end);
        }
        case 'lines': {
            const [startLine, endLine] = pointerValue.split('-').map(s => parseInt(s, 10));
            const lines = text.split('\n');
            if (startLine < 1 || endLine > lines.length) {
                throw new Error(`Line range ${startLine}-${endLine} out of range (1-${lines.length})`);
            }
            return lines.slice(startLine - 1, endLine).join('\n');
        }
        default:
            throw new Error(`Unknown pointer type: ${pointerType}. Supported types: line, char, lines`);
    }
}
/**
 * Resolve a pointer in object claim data.
 * Supports JSON paths, StructuredText paths, and combined paths.
 *
 * Pointer formats:
 * - JSON field: "/field/subfield"
 * - StructuredText: "line:5", "char:10-20", "lines:1-3"
 * - Combined: "/field/subfield#line:5" (JSON path then StructuredText pointer)
 *
 * @param data - The object claim data (JSON object or StructuredText)
 * @param pointer - The pointer string
 * @returns The resolved value
 */
export function resolveObjectPointer(data, pointer) {
    // Check if pointer contains both JSON path and StructuredText pointer
    const hashIndex = pointer.indexOf('#');
    if (hashIndex !== -1) {
        // Combined pointer: "/field#line:5"
        const jsonPath = pointer.substring(0, hashIndex);
        const structuredTextPointer = pointer.substring(hashIndex + 1);
        // First resolve the JSON path
        const intermediate = resolveJsonPath(data, jsonPath);
        // Then resolve the StructuredText pointer on the intermediate value
        if (isStructuredTextData(intermediate)) {
            return extractFromStructuredText(intermediate, structuredTextPointer);
        }
        else {
            throw new Error(`Field at "${jsonPath}" is not StructuredText data`);
        }
    }
    else if (pointer.startsWith('/')) {
        // Pure JSON path
        return resolveJsonPath(data, pointer);
    }
    else if (pointer.includes(':')) {
        // Pure StructuredText pointer
        if (isStructuredTextData(data)) {
            return extractFromStructuredText(data, pointer);
        }
        else {
            throw new Error('Data is not StructuredText format');
        }
    }
    else {
        throw new Error(`Invalid pointer format: "${pointer}"`);
    }
}
/**
 * Parse structured key-value table format into array of objects
 *
 * Format:
 * Key1: Value1
 * Key2: Value2
 *
 * Key1: Value3
 * Key2: Value4
 *
 * Becomes:
 * [
 *   { "Key1": "Value1", "Key2": "Value2" },
 *   { "Key1": "Value3", "Key2": "Value4" }
 * ]
 */
function parseTableFormat(text) {
    const records = [];
    let currentRecord = {};
    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        // Empty line signals end of current record
        if (trimmed === '') {
            if (Object.keys(currentRecord).length > 0) {
                records.push(currentRecord);
                currentRecord = {};
            }
            continue;
        }
        // Parse "Key: Value" format
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) {
            // Skip lines without colons
            continue;
        }
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        currentRecord[key] = value;
    }
    // Don't forget the last record if file doesn't end with blank line
    if (Object.keys(currentRecord).length > 0) {
        records.push(currentRecord);
    }
    return records;
}
/**
 * Transformation functions that can be applied to field values
 */
const TRANSFORMATIONS = {
    parseJson: (value) => {
        if (typeof value !== 'string') {
            throw new Error('parseJson requires a string value');
        }
        try {
            return JSON.parse(value);
        }
        catch (error) {
            throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
    decodeBase64: (value) => {
        if (typeof value !== 'string') {
            throw new Error('decodeBase64 requires a string value');
        }
        try {
            let decoded;
            // Try browser/modern Node.js atob first, fall back to Buffer for older Node.js/CRE
            if (typeof atob !== 'undefined') {
                // Browser or Node.js 16+
                decoded = atob(value);
                // Convert to UTF-8 (atob returns a binary string)
                decoded = decodeURIComponent(escape(decoded));
            }
            else if (typeof Buffer !== 'undefined') {
                // Node.js with Buffer available (CRE environment)
                decoded = Buffer.from(value, 'base64').toString('utf-8');
            }
            else {
                throw new Error('No base64 decoder available (neither atob nor Buffer)');
            }
            // Try to parse as JSON, fall back to string if it fails
            try {
                return JSON.parse(decoded);
            }
            catch {
                return decoded;
            }
        }
        catch (error) {
            throw new Error(`Failed to decode base64: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
    parseTable: (value) => {
        if (typeof value !== 'string') {
            throw new Error('parseTable requires a string value');
        }
        try {
            return parseTableFormat(value);
        }
        catch (error) {
            throw new Error(`Failed to parse table: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
};
/**
 * Parse a transformation function from a path part
 * Format: "@functionName(fieldName)" or "@functionName(.)" where . means current value
 * Returns: { function: 'functionName', field: 'fieldName' } or null if not a transformation
 */
function parseTransformation(part) {
    if (!part.startsWith('@')) {
        return null;
    }
    const match = part.match(/^@(\w+)\(([.\w]+)\)$/);
    if (!match) {
        throw new Error(`Invalid transformation format: "${part}". Expected format: @functionName(fieldName) or @functionName(.)`);
    }
    const [, functionName, fieldName] = match;
    if (!TRANSFORMATIONS[functionName]) {
        throw new Error(`Unknown transformation function: ${functionName}`);
    }
    return { function: functionName, field: fieldName };
}
/**
 * Resolve a JSON path in data
 * Format: "/field/subfield/array/0"
 * Supports transformations: "/field/@decodeBase64(encodedField)/subfield"
 */
function resolveJsonPath(data, path) {
    if (!path.startsWith('/')) {
        throw new Error('JSON path must start with /');
    }
    // Remove leading slash and split
    const parts = path.substring(1).split('/').filter(p => p !== '');
    if (parts.length === 0) {
        return data;
    }
    let current = data;
    for (const part of parts) {
        if (current === null || current === undefined) {
            throw new Error(`Cannot resolve path "${path}": intermediate value is null/undefined`);
        }
        // Check if this is a transformation function FIRST (before type checking)
        // because transformations can operate on any type (strings, objects, etc.)
        const transformation = parseTransformation(part);
        if (transformation) {
            // Apply transformation to the specified field or current value
            let valueToTransform;
            if (transformation.field === '.') {
                // Apply to current value
                valueToTransform = current;
            }
            else {
                // Apply to a specific field (requires current to be an object)
                if (typeof current !== 'object') {
                    throw new Error(`Cannot access field "${transformation.field}" on non-object value (type: ${typeof current})`);
                }
                valueToTransform = current[transformation.field];
                if (valueToTransform === undefined) {
                    throw new Error(`Field "${transformation.field}" not found for transformation @${transformation.function}`);
                }
            }
            const transformFn = TRANSFORMATIONS[transformation.function];
            current = transformFn(valueToTransform);
            continue;
        }
        // For regular path navigation, current must be an object
        if (typeof current !== 'object') {
            throw new Error(`Cannot resolve path "${path}": intermediate value is not an object (type: ${typeof current})`);
        }
        // Handle array indices
        if (Array.isArray(current)) {
            const index = parseInt(part, 10);
            if (isNaN(index)) {
                throw new Error(`Cannot use "${part}" as array index`);
            }
            current = current[index];
        }
        else {
            current = current[part];
        }
        if (current === undefined) {
            throw new Error(`Path "${path}" not found in data`);
        }
    }
    return current;
}
/**
 * Type guard to check if value is StructuredTextData (plain string)
 */
function isStructuredTextData(value) {
    return typeof value === 'string';
}
//# sourceMappingURL=structured-text.js.map