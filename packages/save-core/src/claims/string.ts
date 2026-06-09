/**
 * StringClaim - Represents a textual assertion with optional equality constraint
 *
 * This module provides utilities for creating and working with string claims.
 * Claims can be:
 * - Inline: predefined string value with external proof
 * - Source-backed: pointer to data in an object claim that has a proof
 * - Equality-constrained: verifies the string matches an expected value
 */

import type {
  ClaimId,
  StringClaimContent,
  StringClaimData,
  StringData,
  ClaimPointer,
  ProofData,
  IClaim,
} from '../types/index.js';
import { isStringData, isClaimPointer } from '../types/claim.js';

/**
 * Create a string claim content object.
 *
 * This is the standardized format that external parties should use
 * when creating claims to sign.
 */
export interface CreateStringClaimOptions {
  /** Unique identifier for the claim */
  id: ClaimId;
  /** The string value */
  value: string;
  /** Optional expected value for equality check */
  expectedValue?: string;
  /** Human-readable description */
  description?: string;
}

/**
 * Create a string claim content object that can be signed.
 *
 * @example
 * ```typescript
 * const claim = createStringClaim({
 *   id: 'email_sender',
 *   value: 'artur@vlayer.xyz',
 *   expectedValue: 'artur@vlayer.xyz',
 *   description: 'Email sender verification'
 * });
 * ```
 */
export function createStringClaim(
  options: CreateStringClaimOptions
): StringClaimContent {
  return {
    id: options.id,
    claimType: 'inline',
    dataType: 'string',
    value: options.value,
    expectedValue: options.expectedValue,
    description: options.description,
  };
}

/** Options for creating an inline string claim */
export interface InlineStringClaimOptions {
  /** The signed claim content */
  claim: StringClaimContent;
  /** The proof from the external attester */
  proof: ProofData;
}

/** Options for creating a source-backed string claim */
export interface SourceBackedStringClaimOptions {
  /** Unique identifier for the claim */
  id: ClaimId;
  /** Pointer to object claim: "claimId#/json/pointer/path" */
  dataPointer: ClaimPointer;
  /** Optional expected value for equality check */
  expectedValue?: string;
  /** Human-readable description */
  description?: string;
}

/**
 * StringClaim manages string claims in the attestation builder.
 *
 * Can represent:
 * - Inline: predefined string value with proof
 * - Source-backed: pointer to object claim that has a proof
 * - Equality-constrained: verifies the string matches an expected value
 */
export class StringClaim implements IClaim {
  private readonly _id: ClaimId;
  private readonly _description?: string;
  private _data: StringData | ClaimPointer;
  private readonly _proof?: ProofData;
  private readonly _expectedValue?: string;
  private _resolvedValue?: string; // Store resolved value separately for source-backed claims

  private constructor(
    id: ClaimId,
    data: StringData | ClaimPointer,
    description?: string,
    proof?: ProofData,
    expectedValue?: string
  ) {
    this._id = id;
    this._data = data;
    this._description = description;
    this._proof = proof;
    this._expectedValue = expectedValue;
  }

  /**
   * Create an inline string claim from an externally signed claim.
   *
   * @example
   * ```typescript
   * const claimContent = createStringClaim({
   *   id: 'email_sender',
   *   value: 'artur@vlayer.xyz',
   *   expectedValue: 'artur@vlayer.xyz'
   * });
   * const proof = signClaim(claimContent, privateKey);
   *
   * const claim = StringClaim.inline({
   *   claim: claimContent,
   *   proof: proof
   * });
   * ```
   */
  static inline(options: InlineStringClaimOptions): StringClaim {
    const { claim, proof } = options;

    const data: StringData = {
      value: claim.value,
    };

    return new StringClaim(
      claim.id,
      data,
      claim.description,
      proof,
      claim.expectedValue
    );
  }

  /**
   * Create a source-backed string claim (pointer to object claim).
   *
   * @example
   * ```typescript
   * const claim = StringClaim.sourceBacked({
   *   id: 'email_sender',
   *   dataPointer: 'fund_manager_nav_report#/response/@parseJson(body)/payload/headers[name=From]/value',
   *   expectedValue: 'artur@vlayer.xyz',
   *   description: 'Email sender from verified email'
   * });
   * ```
   */
  static sourceBacked(options: SourceBackedStringClaimOptions): StringClaim {
    return new StringClaim(
      options.id,
      options.dataPointer,
      options.description,
      undefined,
      options.expectedValue
    );
  }

  /** Unique identifier for this claim */
  get id(): ClaimId {
    return this._id;
  }

  /** String data or pointer to it */
  get data(): StringData | ClaimPointer {
    return this._data;
  }

  /** Expected value for equality check (if any) */
  get expectedValue(): string | undefined {
    return this._expectedValue;
  }

  /** Human-readable description */
  get description(): string | undefined {
    return this._description;
  }

  /** Proof data (if inline) */
  get proof(): ProofData | undefined {
    return this._proof;
  }

  /** Whether this is a source-backed claim */
  get isSourceBacked(): boolean {
    return isClaimPointer(this._data);
  }

  /** Whether this is an inline claim */
  get isInline(): boolean {
    return isStringData(this._data) && this._proof !== undefined;
  }

  /** String claims are never aggregated */
  get isAggregated(): boolean {
    return false;
  }

  /** Whether this claim has an equality constraint */
  get hasEqualityConstraint(): boolean {
    return this._expectedValue !== undefined;
  }

  /**
   * Get the actual string value (if data is StringData, not a pointer).
   *
   * @throws Error if this is a source-backed claim
   */
  getValue(): string {
    if (isClaimPointer(this._data)) {
      throw new Error('Cannot get value directly from source-backed claim');
    }
    return this._data.value;
  }

  /**
   * Resolve a source-backed claim with a string value from an object claim
   * @internal
   */
  _resolveFromDataSource(value: string): void {
    if (!this.isSourceBacked) {
      throw new Error('Can only resolve source-backed claims');
    }
    // Store the resolved value separately, keep the pointer intact
    this._resolvedValue = value;
  }

  /**
   * Verify if the claim value matches the expected value.
   *
   * @param actualValue - The actual value to check (for source-backed claims)
   * @returns true if matches expected value, false otherwise
   */
  verifyEquality(actualValue?: string): boolean {
    if (!this._expectedValue) {
      // No constraint, always passes
      return true;
    }

    const valueToCheck = actualValue ?? (isStringData(this._data) ? this._data.value : undefined);
    
    if (valueToCheck === undefined) {
      throw new Error('Cannot verify equality: no value provided and claim is source-backed');
    }

    return valueToCheck === this._expectedValue;
  }

  /**
   * Convert to serializable data format for inclusion in attestation.
   */
  toData(): StringClaimData {
    if (this.isSourceBacked && isClaimPointer(this._data)) {
      return {
        id: this._id,
        claimType: 'source-backed',
        dataType: 'string',
        pointer: this._data,
        ...(this._resolvedValue !== undefined && { resolvedValue: this._resolvedValue }),
        ...(this._expectedValue !== undefined && { expectedValue: this._expectedValue }),
        ...(this._description !== undefined && { description: this._description }),
      };
    }

    // Inline claim
    if (!this._proof) {
      throw new Error(`Inline claim ${this._id} is missing proof`);
    }
    if (!isStringData(this._data)) {
      throw new Error(`Inline claim ${this._id} is missing string data`);
    }
    return {
      id: this._id,
      claimType: 'inline',
      dataType: 'string',
      data: this._data,
      proof: this._proof,
      ...(this._expectedValue !== undefined && { expectedValue: this._expectedValue }),
      ...(this._description !== undefined && { description: this._description }),
    };
  }

  /** String claims dependencies getter (for DAG) */
  get dependencies(): ClaimId[] {
    if (isClaimPointer(this._data)) {
      const hashIndex = this._data.indexOf('#');
      if (hashIndex !== -1) {
        const claimId = this._data.substring(0, hashIndex);
        return [claimId as ClaimId];
      }
    }
    return [];
  }

  /** String claims are primitive (leaf or source-backed, not aggregated) */
  get isPrimitive(): boolean {
    return true;
  }

  /** String claims are not composite (no aggregation) */
  get isComposite(): boolean {
    return false;
  }

  /** Check if the claim has a resolved value */
  get isResolved(): boolean {
    if (this.isSourceBacked) {
      return this._resolvedValue !== undefined;
    }
    // Inline claims are always resolved
    return true;
  }

  /** Get the resolved or inline value */
  get value(): string | undefined {
    if (this._resolvedValue !== undefined) {
      return this._resolvedValue;
    }
    if (isStringData(this._data)) {
      return this._data.value;
    }
    return undefined;
  }
}
