/**
 * Object claim format types
 *
 * Defines the different formats that object claims can use to store data.
 */
/** Supported object claim formats */
export type ObjectClaimFormat = 'json' | 'structured-text';
/**
 * Template for structured text validation.
 * Defines expected keys and their types.
 */
export interface StructuredTextTemplate {
    /** Template fields in order */
    fields: TemplateField[];
}
/** Field definition in a template */
export interface TemplateField {
    /** Field key/name */
    key: string;
    /** Expected value type */
    type: TemplateFieldType;
}
/** Supported field types in structured text */
export type TemplateFieldType = 'string' | 'number' | 'date' | 'timestamp' | 'boolean';
/**
 * Structured text data - plain text that can be referenced via line/char pointers
 * This is simply a string that can be pointed to using:
 * - line:N (specific line)
 * - char:START-END (character range)
 * - lines:START-END (line range)
 */
export type StructuredTextData = string;
/**
 * Pointer for structured text.
 * Supports line/character addressing only.
 *
 * Formats:
 * - Field by line: "claimId#line:3"
 * - Character range: "claimId#char:11-20"
 * - Line range: "claimId#lines:1-7"
 */
export type StructuredTextPointer = string;
/** Validation result for structured text against template */
export interface ValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Validation errors if any */
    errors: ValidationError[];
    /** Warnings (non-critical issues) */
    warnings: ValidationWarning[];
}
/** Validation error */
export interface ValidationError {
    /** Field that failed validation */
    field: string;
    /** Error message */
    message: string;
    /** Line number where error occurred */
    line?: number;
}
/** Validation warning */
export interface ValidationWarning {
    /** Field with warning */
    field?: string;
    /** Warning message */
    message: string;
    /** Line number */
    line?: number;
}
//# sourceMappingURL=object-format.d.ts.map