/**
 * NumericClaim - Represents a quantitative assertion
 *
 * This module provides utilities for creating and working with numeric claims.
 * Claims can be:
 * - Inline: predefined structure (numeric data) with external proof
 * - Source-backed: pointer to data in an object claim that has a proof
 * - Aggregated: computed from other claims using aggregation functions
 */
import type { ClaimId, NumericClaimContent, NumericClaimData, NumericData, ClaimPointer, ProofData, NumericAggregation, AssetReference, IClaim } from '../types/index.js';
/**
 * Create a numeric claim content object.
 *
 * This is the standardized format that external parties should use
 * when creating claims to sign.
 */
export interface CreateNumericClaimOptions {
    /** Unique identifier for the claim */
    id: ClaimId;
    /** The numeric value */
    value: number;
    /** Unit of measurement */
    unit: string;
    /** On-chain asset reference (address and chainId must be provided together) */
    asset?: AssetReference;
    /** Human-readable description */
    description?: string;
}
/**
 * Create a numeric claim content object that can be signed.
 *
 * Use this function to create standardized claim objects that
 * external parties can sign.
 *
 * @example
 * ```typescript
 * const claim = createNumericClaim({
 *   id: 'eth_balance',
 *   value: 600000,
 *   unit: 'USDC',
 *   description: 'Ethereum holdings'
 * });
 * // External party signs this claim
 * const proof = signClaim(claim, privateKey);
 * ```
 */
export declare function createNumericClaim(options: CreateNumericClaimOptions): NumericClaimContent;
/** Options for creating an inline numeric claim */
export interface InlineNumericClaimOptions {
    /** The signed claim content */
    claim: NumericClaimContent;
    /** The proof from the external attester */
    proof: ProofData;
}
/** Options for creating a source-backed numeric claim */
export interface SourceBackedNumericClaimOptions {
    /** Unique identifier for the claim */
    id: ClaimId;
    /** Pointer to object claim: "claimId#/json/pointer/path" */
    dataPointer: ClaimPointer;
    /** Default unit when the resolved value is a plain number (e.g., 'USD'). Required if the pointer resolves to a raw number. */
    unit?: string;
    /** Human-readable description */
    description?: string;
}
/** Options for creating an aggregated numeric claim */
export interface AggregatedNumericClaimOptions {
    /** Unique identifier for the claim */
    id: ClaimId;
    /** Human-readable description */
    description?: string;
    /** Aggregation defining how value is derived from sub-claims */
    aggregation: NumericAggregation;
}
/**
 * NumericClaim manages numeric claims in the attestation builder.
 *
 * Can represent:
 * - Inline: predefined structure (numeric data) with proof
 * - Source-backed: pointer to object claim that has a proof
 * - Aggregated: computed from other claims using aggregation functions
 */
export declare class NumericClaim implements IClaim {
    private readonly _id;
    private readonly _description?;
    private readonly _data;
    private readonly _proof?;
    private readonly _aggregation?;
    private readonly _unit?;
    private _resolvedValue?;
    private constructor();
    /**
     * Create an inline numeric claim from an externally signed claim.
     *
     * Inline claims have a predefined structure (numeric data) and contain both
     * the data and the proof for it.
     *
     * @example
     * ```typescript
     * // External party creates and signs a claim
     * const claimContent = createNumericClaim({
     *   id: 'eth_balance',
     *   value: 600000,
     *   unit: 'USDC'
     * });
     * const proof = signClaim(claimContent, custodianPrivateKey);
     *
     * // Protocol receives and wraps the signed claim
     * const claim = NumericClaim.inline({
     *   claim: claimContent,
     *   proof: proof
     * });
     * ```
     */
    static inline(options: InlineNumericClaimOptions): NumericClaim;
    /**
     * Create a source-backed numeric claim (pointer to object claim).
     *
     * @example
     * ```typescript
     * const claim = NumericClaim.sourceBacked({
     *   id: 'cex_assets',
     *   dataPointer: 'cex_snapshot_001#/accounts/0/balance',
     *   description: 'CEX balance from snapshot'
     * });
     * ```
     */
    static sourceBacked(options: SourceBackedNumericClaimOptions): NumericClaim;
    /**
     * Create an aggregated numeric claim.
     * Value will be computed when the claim is resolved in a DAG.
     *
     * @example
     * ```typescript
     * const claim = NumericClaim.aggregated({
     *   id: 'net_position',
     *   aggregation: {
     *     function: 'subtract',
     *     operands: ['assets', 'liabilities']
     *   }
     * });
     * ```
     */
    static aggregated(options: AggregatedNumericClaimOptions): NumericClaim;
    /** Unique identifier for this claim */
    get id(): ClaimId;
    /** Human-readable description */
    get description(): string | undefined;
    /** Check if this is an inline claim (predefined structure with proof) */
    get isInline(): boolean;
    /** Check if this is a source-backed (pointer) claim */
    get isSourceBacked(): boolean;
    /** Check if this is an aggregated claim */
    get isAggregated(): boolean;
    /** Get the proof (only for inline claims) */
    get proof(): ProofData | undefined;
    /** Get the aggregation (only for aggregated claims) */
    get aggregation(): NumericAggregation | undefined;
    /** Get the data (NumericData for inline, ClaimPointer for source-backed, undefined for aggregated) */
    get data(): NumericData | ClaimPointer | undefined;
    /** Default unit for source-backed claims resolved to plain numbers */
    get unit(): string | undefined;
    /** Get IDs of all claims this claim depends on (source-backed pointer or aggregation operands) */
    get dependencies(): ClaimId[];
    /**
     * Get the value (for inline data or after DAG resolution)
     * Returns undefined for unresolved aggregated claims or unresolved pointer claims
     */
    get value(): number | undefined;
    /**
     * Check if the claim has a resolved value
     */
    get isResolved(): boolean;
    /** Primitive claims are leaf nodes: inline or source-backed (not aggregated) */
    get isPrimitive(): boolean;
    /** Composite claims are aggregated claims */
    get isComposite(): boolean;
    /**
     * Set the computed value (used by DAG resolver)
     * For aggregated claims, stores the computed value in _resolvedValue
     * @internal
     */
    _setComputedValue(value: number): void;
    /**
     * Resolve a source-backed claim with data from an object claim
     * @internal
     */
    _resolveFromDataSource(data: NumericData): void;
    /**
     * Export claim to data format for attestation
     */
    toData(): NumericClaimData;
}
//# sourceMappingURL=numeric.d.ts.map