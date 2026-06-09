/**
 * Claim types for SAVE
 *
 * Claims are standardized assertions that can be:
 * 1. Inline: predefined structure (e.g., numeric claims) with data and proof
 * 2. Source-backed: pointer to data in an object claim that has a proof
 * 3. Aggregated: computed from other claims using aggregation functions
 *
 * The claim structure is canonical to ensure consistent signing/verification.
 */
import type { ClaimId, HexString } from './common.js';
import type { ProofData } from './proof.js';
import type { Aggregation } from './aggregation.js';
import type { ObjectClaimFormat, StructuredTextData } from './object-format.js';
/** Supported claim data types */
export type DataType = 'numeric' | 'string' | 'object';
/** Supported claim types (variants) */
export type ClaimType = 'inline' | 'source-backed' | 'aggregation';
/**
 * Pointer to data in an object claim.
 * Format: "claimId#/json/pointer/path"
 * Example: "cex_snapshot#/accounts/0/balance"
 */
export type ClaimPointer = string;
/**
 * On-chain asset reference.
 * Links a claim to a specific token contract on a specific chain.
 * Both fields are required together.
 */
export interface AssetReference {
    /** ERC20 token contract address */
    address: HexString;
    /** Chain ID (e.g., 1 for Ethereum mainnet, 42161 for Arbitrum) */
    chainId: number;
}
/**
 * Base claim structure - the core assertion data that gets signed.
 * This is what external parties create and sign.
 */
export interface BaseClaim {
    /** Unique identifier for this claim */
    id: ClaimId;
    /** Type of the claim (inline, source-backed, or aggregation) */
    claimType: ClaimType;
    /** Data type (numeric, string, or object) */
    dataType: DataType;
    /** Human-readable description */
    description?: string;
}
/**
 * Numeric claim - a quantitative assertion
 *
 * This is the standardized format that external parties use
 * to create claims that they will sign.
 */
export interface NumericClaimContent extends BaseClaim {
    claimType: 'inline';
    dataType: 'numeric';
    /** The numeric value being claimed */
    value: number;
    /** Unit of measurement (e.g., 'USDC', 'ETH', 'USD') */
    unit: string;
    /** On-chain asset reference (optional, but address and chainId must be together) */
    asset?: AssetReference;
}
/**
 * String claim - a textual assertion with optional equality constraint
 *
 * This is the standardized format that external parties use
 * to create string claims that they will sign.
 */
export interface StringClaimContent extends BaseClaim {
    claimType: 'inline';
    dataType: 'string';
    /** The string value being claimed */
    value: string;
    /** Optional expected value for equality verification */
    expectedValue?: string;
}
/**
 * Object claim content - proven data container
 *
 * This is the format external parties use to sign object claims.
 * Object claims are always inline (they have data and proof).
 */
export interface ObjectClaimContent extends BaseClaim {
    /** Type is always 'inline' for object claims */
    claimType: 'inline';
    /** Data type is always 'object' */
    dataType: 'object';
    /** Format of the data (json or structured-text) */
    format: ObjectClaimFormat;
    /** Data: JSON or StructuredText */
    data: Record<string, unknown> | StructuredTextData;
}
/** Union of all claim content types that can be signed */
export type ClaimContent = NumericClaimContent | StringClaimContent | ObjectClaimContent;
/**
 * An inline claim with its proof.
 *
 * This represents a claim with predefined structure that has been attested
 * by an external party and includes their cryptographic proof (signature).
 */
export interface ClaimWithProof<T extends ClaimContent = ClaimContent> {
    /** The claim content that was signed */
    claim: T;
    /** The proof attesting to this claim */
    proof: ProofData;
}
/**
 * Aggregation reference for composite claims.
 * Composite claims derive their value from other claims.
 */
export interface AggregationRef {
    /** The aggregation function and sub-claim references */
    aggregation: Aggregation;
}
/**
 * Numeric data structure for inline or aggregated claims
 */
export interface NumericData {
    /** The numeric value */
    value: number;
    /** Unit of measurement */
    unit: string;
    /** On-chain asset reference (optional) */
    asset?: AssetReference;
}
/**
 * Full numeric claim data as stored in an attestation.
 * Discriminated union on claimType:
 * - 'inline': has data and proof
 * - 'source-backed': has pointer, optional resolvedValue
 * - 'aggregation': has aggregation, optional resolvedValue
 */
/** Inline numeric claim — has data and proof */
export interface InlineNumericClaimData {
    id: ClaimId;
    claimType: 'inline';
    dataType: 'numeric';
    data: NumericData;
    proof: ProofData;
    description?: string;
}
/** Source-backed numeric claim — points to data in an object claim */
export interface SourceBackedNumericClaimData {
    id: ClaimId;
    claimType: 'source-backed';
    dataType: 'numeric';
    pointer: ClaimPointer;
    resolvedValue?: number;
    description?: string;
}
/** Aggregated numeric claim — computed from other claims */
export interface AggregatedNumericClaimData {
    id: ClaimId;
    claimType: 'aggregation';
    dataType: 'numeric';
    aggregation: Aggregation;
    resolvedValue?: number;
    description?: string;
}
export type NumericClaimData = InlineNumericClaimData | SourceBackedNumericClaimData | AggregatedNumericClaimData;
/**
 * String data structure for inline claims
 */
export interface StringData {
    /** The string value */
    value: string;
}
/**
 * Full string claim data as stored in an attestation.
 * Discriminated union on claimType:
 * - 'inline': has data and proof
 * - 'source-backed': has pointer, optional resolvedValue
 */
/** Inline string claim — has data and proof */
export interface InlineStringClaimData {
    id: ClaimId;
    claimType: 'inline';
    dataType: 'string';
    data: StringData;
    proof: ProofData;
    expectedValue?: string;
    description?: string;
}
/** Source-backed string claim — points to data in an object claim */
export interface SourceBackedStringClaimData {
    id: ClaimId;
    claimType: 'source-backed';
    dataType: 'string';
    pointer: ClaimPointer;
    resolvedValue?: string;
    expectedValue?: string;
    description?: string;
}
export type StringClaimData = InlineStringClaimData | SourceBackedStringClaimData;
/**
 * Object claim data as stored in an attestation.
 *
 * Object claims are ALWAYS leaf nodes:
 * - MUST have inline data (JSON or StructuredText)
 * - MUST have a proof
 * - CANNOT have aggregation
 * - CANNOT contain claim pointers as values
 *
 * TODO: Add schemaId and schemaHash for validation and version pinning
 *
 * Data can be:
 * - Pure JSON object: format='json', data=Record<string, unknown>
 * - Pure StructuredText: format='structured-text', data=StructuredTextData
 * - Mixed: format='json', data can contain StructuredTextData as field values
 *
 * Other claims can reference into object claims using ClaimPointers with formats:
 * - JSON field: "claimId#/field/subfield"
 * - StructuredText line: "claimId#line:5"
 * - StructuredText char range: "claimId#char:10-20"
 * - Mixed (JSON field with StructuredText): "claimId#/field#line:5"
 */
export interface ObjectClaimData {
    /** Unique identifier for this claim */
    id: ClaimId;
    /** Type is always 'inline' for object claims */
    claimType: 'inline';
    /** Data type is always 'object' */
    dataType: 'object';
    /** Format of the data (json or structured-text) */
    format: ObjectClaimFormat;
    /** Data must be either JSON or StructuredText */
    data: Record<string, unknown> | StructuredTextData;
    /** Human-readable description */
    description?: string;
    /** Proof (required for object claims) */
    proof: ProofData;
}
/** Union of all claim data types */
export type ClaimData = NumericClaimData | StringClaimData | ObjectClaimData;
/** Type guard for numeric claim content */
export declare function isNumericClaimContent(claim: ClaimContent): claim is NumericClaimContent;
/** Type guard for string claim content */
export declare function isStringClaimContent(claim: ClaimContent): claim is StringClaimContent;
/** Type guard for object claim content */
export declare function isObjectClaimContent(claim: ClaimContent): claim is ObjectClaimContent;
/** Helper union types for claimType narrowing */
export type InlineClaimData = InlineNumericClaimData | InlineStringClaimData | ObjectClaimData;
export type SourceBackedClaimData = SourceBackedNumericClaimData | SourceBackedStringClaimData;
export type AggregatedClaimData = AggregatedNumericClaimData;
/** Check if claim data is an inline claim (narrows to InlineClaimData) */
export declare function isInlineClaim(claim: ClaimData): claim is InlineClaimData;
/** Check if claim data is a source-backed claim (narrows to SourceBackedClaimData) */
export declare function isSourceBackedClaim(claim: ClaimData): claim is SourceBackedClaimData;
/** Check if claim data is an aggregated claim (narrows to AggregatedClaimData) */
export declare function isAggregatedClaim(claim: ClaimData): claim is AggregatedClaimData;
/** Type guard for NumericData */
export declare function isNumericData(data: NumericData | ClaimPointer | undefined): data is NumericData;
/** Type guard for StringData */
export declare function isStringData(data: StringData | ClaimPointer | undefined): data is StringData;
/** Type guard for ClaimPointer */
export declare function isClaimPointer(data: NumericData | StringData | ClaimPointer | undefined): data is ClaimPointer;
/** Type guard for ObjectClaimData */
export declare function isObjectClaim(claim: ClaimData): claim is ObjectClaimData;
/** Type guard for NumericClaimData */
export declare function isNumericClaim(claim: ClaimData): claim is NumericClaimData;
/** Type guard for StringClaimData */
export declare function isStringClaim(claim: ClaimData): claim is StringClaimData;
/**
 * Create the canonical representation of a claim for signing.
 * This ensures all parties produce the same bytes when signing.
 * Uses discriminated union narrowing on dataType for type safety.
 */
export declare function canonicalizeClaimForSigning(claim: ClaimContent): string;
//# sourceMappingURL=claim.d.ts.map