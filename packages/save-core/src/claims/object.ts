/**
 * Object claims for SAVE
 * 
 * Object claims are proven data containers that other claims can reference.
 * They are ALWAYS leaf nodes in the DAG:
 * - MUST have inline data (JSON, StructuredText, or mixed)
 * - MUST have a proof
 * - CANNOT have aggregation
 * - CANNOT contain claim pointers as values
 * 
 * Data formats:
 * - Pure JSON: format='json', data=any JSON-serializable value
 * - Pure StructuredText: format='structured-text', data=StructuredTextData
 * - Mixed: format='json', data can contain StructuredTextData as field values
 * 
 * Pointer formats for referencing data:
 * - JSON field: "/field/subfield"
 * - StructuredText: "line:5", "char:10-20", "lines:1-3"
 * - Combined: "/field#line:5" (JSON path then StructuredText pointer)
 */

import type { ClaimId } from '../types/common.js';
import type { ObjectClaimData } from '../types/claim.js';
import type { ProofData } from '../types/proof.js';
import type { IClaim } from '../types/iclaim.js';
import type {
  ObjectClaimFormat,
  StructuredTextData,
} from '../types/object-format.js';
import {
  resolveObjectPointer,
} from './structured-text.js';

/** Options for creating an object claim with JSON data */
export interface ObjectClaimOptions {
  /** Unique identifier for the claim */
  id: ClaimId;
  /** Format (defaults to 'json') */
  format?: 'json';
  /** JSON data (can contain StructuredTextData fields for mixed data) */
  data: Record<string, unknown>;
  // TODO: Add schemaId and schemaHash for validation and version pinning
  /** Human-readable description */
  description?: string;
  /** Proof attesting to this data (required) */
  proof: ProofData;
}

/** Options for creating an object claim with structured text */
export interface StructuredTextClaimOptions {
  /** Unique identifier for the claim */
  id: ClaimId;
  /** Format must be 'structured-text' */
  format: 'structured-text';
  /** Plain text content */
  data: string;
  // TODO: Add schemaId and schemaHash for validation and version pinning
  /** Human-readable description */
  description?: string;
  /** Proof attesting to this data (required) */
  proof: ProofData;
}

/**
 * ObjectClaim represents a proven data container.
 * 
 * Object claims serve as data sources that other claims can reference using ClaimPointers.
 * They are always leaf nodes in the dependency graph - they cannot aggregate or reference other claims.
 */
export class ObjectClaim implements IClaim {
  private readonly _id: ClaimId;
  private readonly _format: ObjectClaimFormat;
  private readonly _data: Record<string, unknown> | StructuredTextData;
  // TODO: Add _schemaId and _schemaHash for validation and version pinning
  private readonly _description?: string;
  private readonly _proof: ProofData;

  constructor(options: ObjectClaimOptions | StructuredTextClaimOptions) {
    this._id = options.id;
    this._description = options.description;
    this._proof = options.proof;

    // Handle different formats
    if (options.format === 'structured-text') {
      // Structured text is just plain text
      this._format = 'structured-text';
      this._data = options.data;
    } else {
      // JSON format (default)
      this._format = 'json';
      this._data = options.data;
    }

    // Validate that this is a leaf claim
    this.validateLeafNode();
  }

  /**
   * Validate that this is a proper leaf node (no aggregations or pointers)
   */
  private validateLeafNode(): void {
    // Object claims are always leaf nodes - no runtime validation needed.
    // Pointer-like substrings (e.g. "#/") in data values are normal
    // (URLs, email headers, etc.) and don't indicate actual claim pointers.
  }

  /** Get claim ID */
  get id(): ClaimId {
    return this._id;
  }

  /** Get format */
  get format(): ObjectClaimFormat {
    return this._format;
  }

  /** Get data */
  get data(): Record<string, unknown> | StructuredTextData {
    return this._data;
  }

  // TODO: Add schemaId and schemaHash getters for validation and version pinning

  /** Get description */
  get description(): string | undefined {
    return this._description;
  }

  /** Get proof */
  get proof(): ProofData {
    return this._proof;
  }

  /** Object claims are always leaf nodes */
  get isPrimitive(): boolean {
    return true;
  }

  /** Object claims cannot be composite */
  get isComposite(): boolean {
    return false;
  }

  /** Object claims are always resolved (they have inline data) */
  get isResolved(): boolean {
    return true;
  }

  /** Object claims have no dependencies (they're leaf nodes) */
  get dependencies(): string[] {
    return [];
  }

  /** Object claims don't have a numeric value */
  get value(): undefined {
    return undefined;
  }

  /** Object claims are always inline (they contain their own data and proof) */
  get isInline(): boolean {
    return true;
  }

  /** Object claims are not source-backed */
  get isSourceBacked(): boolean {
    return false;
  }

  /** Object claims are not aggregated */
  get isAggregated(): boolean {
    return false;
  }

  /**
   * Check if this is a structured text claim
   */
  get isStructuredText(): boolean {
    return this._format === 'structured-text';
  }

  /**
   * Check if this is a JSON claim
   */
  get isJSON(): boolean {
    return this._format === 'json';
  }

  /**
   * Extract value using a pointer.
   * 
   * Supported pointer formats:
   * - JSON field: "/field/subfield" or "/array/0"
   * - StructuredText: "line:5", "char:10-20", "lines:1-3"
   * - Combined: "/field#line:5" (JSON path then StructuredText pointer)
   * 
   * Examples:
   * - extract("/email") - Get email field from JSON
   * - extract("line:3") - Get line 3 from StructuredText
   * - extract("/emailBody#line:2") - Get line 2 from StructuredText in emailBody field
   * 
   * @param pointer - The pointer string
   * @returns The extracted value
   */
  extract(pointer: string): unknown {
    return resolveObjectPointer(this._data, pointer);
  }

  /**
   * Resolve a pointer within this claim's data
   * 
   * @param pointer - JSON pointer path, optionally with transformations and StructuredText selectors
   * @returns The resolved value
   * 
   * @example
   * ```typescript
   * const value = claim.resolve('/@parseTable(snippet)/0/Token');
   * const decoded = claim.resolve('/@decodeBase64(data)/field');
   * const char = claim.resolve('/field#char:0-10');
   * ```
   */
  resolve(pointer: string): unknown {
    return resolveObjectPointer(this._data, pointer);
  }

  /**
   * Export claim to data format for attestation
   */
  toData(): ObjectClaimData {
    const claimData: ObjectClaimData = {
      id: this._id,
      claimType: 'inline',
      dataType: 'object',
      format: this._format,
      data: this._data,
      // TODO: Add schemaId and schemaHash
      proof: this._proof,
    };

    if (this._description) {
      claimData.description = this._description;
    }

    return claimData;
  }
}
