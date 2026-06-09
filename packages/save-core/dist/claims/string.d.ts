/**
 * StringClaim - Represents a textual assertion with optional equality constraint
 *
 * This module provides utilities for creating and working with string claims.
 * Claims can be:
 * - Inline: predefined string value with external proof
 * - Source-backed: pointer to data in an object claim that has a proof
 * - Equality-constrained: verifies the string matches an expected value
 */
import type { ClaimId, StringClaimContent, StringClaimData, StringData, ClaimPointer, ProofData, IClaim } from '../types/index.js';
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
export declare function createStringClaim(options: CreateStringClaimOptions): StringClaimContent;
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
export declare class StringClaim implements IClaim {
    private readonly _id;
    private readonly _description?;
    private _data;
    private readonly _proof?;
    private readonly _expectedValue?;
    private _resolvedValue?;
    private constructor();
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
    static inline(options: InlineStringClaimOptions): StringClaim;
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
    static sourceBacked(options: SourceBackedStringClaimOptions): StringClaim;
    /** Unique identifier for this claim */
    get id(): ClaimId;
    /** String data or pointer to it */
    get data(): StringData | ClaimPointer;
    /** Expected value for equality check (if any) */
    get expectedValue(): string | undefined;
    /** Human-readable description */
    get description(): string | undefined;
    /** Proof data (if inline) */
    get proof(): ProofData | undefined;
    /** Whether this is a source-backed claim */
    get isSourceBacked(): boolean;
    /** Whether this is an inline claim */
    get isInline(): boolean;
    /** String claims are never aggregated */
    get isAggregated(): boolean;
    /** Whether this claim has an equality constraint */
    get hasEqualityConstraint(): boolean;
    /**
     * Get the actual string value (if data is StringData, not a pointer).
     *
     * @throws Error if this is a source-backed claim
     */
    getValue(): string;
    /**
     * Resolve a source-backed claim with a string value from an object claim
     * @internal
     */
    _resolveFromDataSource(value: string): void;
    /**
     * Verify if the claim value matches the expected value.
     *
     * @param actualValue - The actual value to check (for source-backed claims)
     * @returns true if matches expected value, false otherwise
     */
    verifyEquality(actualValue?: string): boolean;
    /**
     * Convert to serializable data format for inclusion in attestation.
     */
    toData(): StringClaimData;
    /** String claims dependencies getter (for DAG) */
    get dependencies(): ClaimId[];
    /** String claims are primitive (leaf or source-backed, not aggregated) */
    get isPrimitive(): boolean;
    /** String claims are not composite (no aggregation) */
    get isComposite(): boolean;
    /** Check if the claim has a resolved value */
    get isResolved(): boolean;
    /** Get the resolved or inline value */
    get value(): string | undefined;
}
//# sourceMappingURL=string.d.ts.map