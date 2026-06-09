/**
 * Attestation Verifier
 *
 * Verifies SAVE attestations by checking:
 * - Attestation signature validity
 * - Individual claim proofs
 * - Aggregation correctness
 * - Source-backed claim resolution
 */
import type { AttestationData, ClaimData, VerificationData, Verifier as VerifierInfo, HexString, ProofData, HttpClient } from '../types/index.js';
/** Vlayer API credentials */
export interface VlayerCredentials {
    clientId: string;
    authToken: string;
}
/** Options for running verification */
export interface VerifyAttestationOptions {
    /** Information about the verifier performing this verification */
    verifier: VerifierInfo;
    /** Verification timestamp (ISO 8601). Must be provided externally for deterministic output. */
    verifiedAt: string;
    /** Private key to sign the verification (required) */
    signingKey: HexString;
    /** Custom HTTP client for proof verification (defaults to fetch-based client) */
    httpClient?: HttpClient;
    /** Vlayer credentials for ZK-TLS Notary proof verification */
    vlayerCredentials?: VlayerCredentials;
    /** Whether to reject expired attestations (default: true). Set to false for historical verification. */
    checkExpiration?: boolean;
}
/**
 * Verify a complete attestation and generate a verification document
 */
export declare function verifyAttestation(attestation: AttestationData, options: VerifyAttestationOptions): Promise<VerificationData>;
/** A function that verifies a specific proof mechanism */
export type ProofVerifierFn = (proof: ProofData, claimData: ClaimData, options?: VerifyAttestationOptions) => Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * Register a proof verifier for a given mechanism name.
 *
 * @param mechanism - The proof mechanism name (e.g., 'signature', 'zk_tls_notary', 'custom_zkp')
 * @param handler - Async function that verifies the proof
 *
 * @example
 * ```typescript
 * registerProofVerifier('custom_zkp', async (proof, claimData, options) => {
 *   // Custom verification logic
 *   return { success: true };
 * });
 * ```
 */
export declare function registerProofVerifier(mechanism: string, handler: ProofVerifierFn): void;
//# sourceMappingURL=verifier.d.ts.map