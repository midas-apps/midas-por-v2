/**
 * Structured text utilities for object claims
 *
 * Structured text is plain text that can be referenced via line/char pointers.
 */
import type { StructuredTextData } from '../types/object-format.js';
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
export declare function extractFromStructuredText(text: StructuredTextData, pointer: string): string;
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
export declare function resolveObjectPointer(data: Record<string, unknown> | StructuredTextData, pointer: string): unknown;
//# sourceMappingURL=structured-text.d.ts.map