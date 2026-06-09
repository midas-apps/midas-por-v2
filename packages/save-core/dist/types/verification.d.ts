/**
 * Verification types for SAVE
 *
 * Types for verification results when validating attestations
 */
import type { ClaimId, Timestamp, HexString, SignatureAlgorithm } from './common.js';
/** Status of a verification check */
export type VerificationStatus = 'Valid' | 'Invalid' | 'Uncertain';
/** Verifier identity information */
export interface Verifier {
    /** Name of the verifying entity */
    name: string;
    /** Verifier's public key */
    publicKey: HexString;
    /** DID or other identifier (optional) */
    did?: string;
}
/** Evidence for an inline claim verification */
export interface InlineClaimEvidence {
    proof: {
        trustModel: string;
        mechanism: string;
    };
    value: unknown;
    notes: string;
}
/** Evidence for a source-backed claim verification */
export interface SourceBackedClaimEvidence {
    /** Full pointer in attestation syntax: "claimId#/path" */
    pointer: string;
    resolvedValue: unknown;
    expectedValue?: unknown;
    notes: string;
}
/** Evidence for an aggregated claim verification */
export interface AggregatedClaimEvidence {
    aggregationVerified: boolean;
    computedValue: number;
    expectedValue?: number;
    notes: string;
}
/** Union of all evidence types */
export type ClaimEvidence = InlineClaimEvidence | SourceBackedClaimEvidence | AggregatedClaimEvidence;
/** Verification outcome for a single claim */
export interface ClaimVerificationOutcome {
    /** ID of the claim being verified */
    claimId: ClaimId;
    /** Type of the claim (inline, source-backed, or aggregation) */
    claimType: 'inline' | 'source-backed' | 'aggregation';
    /** Data type of the claim */
    dataType: 'numeric' | 'string' | 'object';
    /** Verification status */
    status: VerificationStatus;
    /** Evidence supporting the verification */
    evidence: ClaimEvidence;
    /** Error message if verification failed */
    error?: string;
}
/** Summary statistics for the verification */
export interface VerificationSummary {
    totalClaims: number;
    validClaims: number;
    invalidClaims: number;
    uncertainClaims: number;
    overallStatus: VerificationStatus;
}
/** Metadata about the verification */
export interface VerificationMetadata {
    /** Information about the verifier */
    verifier: Verifier;
    /** When the verification was performed */
    verifiedAt: Timestamp;
    /** ID of the attestation being verified */
    attestationId: string;
    /** Unique ID for this verification */
    verificationId: string;
    /** Hash of the attestation being verified (for on-chain verification) */
    attestationHash?: HexString;
    /** Proof ID this verification is related to (for on-chain verification) */
    proofId?: HexString;
}
/** Signature over the verification */
export interface VerificationSignature {
    algorithm: SignatureAlgorithm;
    publicKey: HexString;
    signature: HexString;
    signedData: HexString;
}
/** Error information for a failed or uncertain claim */
export interface ClaimVerificationError {
    /** ID of the claim that failed */
    claimId: ClaimId;
    /** Verification status (Invalid or Uncertain) */
    status: 'Invalid' | 'Uncertain';
    /** Error message */
    error?: string;
    /** Evidence that led to this status */
    evidence: ClaimEvidence;
}
/** Complete verification document */
export interface VerificationData {
    /** Verification metadata */
    metadata: VerificationMetadata;
    /** Individual claim verification outcomes */
    outcomes: ClaimVerificationOutcome[];
    /** Summary statistics */
    summary: VerificationSummary;
    /** Signature over the verification */
    signature: VerificationSignature;
    /** Consolidated array of errors for failed/uncertain claims */
    errors: ClaimVerificationError[];
}
//# sourceMappingURL=verification.d.ts.map