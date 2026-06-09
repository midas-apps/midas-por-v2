/**
 * SignatureProof - ECDSA signature-based proof for claims
 *
 * This module provides utilities for signing claims using ECDSA.
 * External parties (custodians, auditors) use this to create
 * proofs that attest to claim values.
 */
import { canonicalizeClaimForSigning } from '../types/claim.js';
import { sign, getPublicKey } from '../crypto/ecdsa.js';
/**
 * Sign a claim with ECDSA.
 *
 * This is the primary function for external parties to create proofs.
 * The claim content (including timestamp) is canonicalized and signed.
 *
 * @param claim - The claim content to sign
 * @param privateKey - The signer's private key
 * @param options - Signer identity and optional public key source URL
 * @returns SignatureProofData ready to be bundled with the claim
 *
 * @example
 * ```typescript
 * // Custodian creates and signs a claim
 * const claim = createNumericClaim({
 *   id: 'eth_balance',
 *   value: 600000,
 *   unit: 'USDC',
 *   description: 'Ethereum mainnet holdings'
 * });
 *
 * const proof = signClaim(claim, custodianPrivateKey, {
 *   signerIdentity: 'Custodian Inc',
 *   publicKeySource: 'https://custodian.com/.well-known/keys.json'
 * });
 *
 * // The claim + proof can now be sent to the protocol
 * ```
 */
export function signClaim(claim, privateKey, options) {
    const opts = options;
    const publicKey = getPublicKey(privateKey);
    const canonicalData = canonicalizeClaimForSigning(claim);
    const signature = sign(canonicalData, privateKey);
    return {
        trustModel: 'reputational',
        mechanism: 'signature',
        algorithm: 'ECDSA_secp256k1',
        signerPublicKey: publicKey,
        publicKeySource: opts.publicKeySource,
        signerIdentity: opts.signerIdentity,
        signature,
    };
}
/**
 * Create a proof from an externally provided signature.
 *
 * Use this when the signature was created by an external system
 * and you need to construct the proof object.
 *
 * @param options - The signature details
 * @returns SignatureProofData
 */
export function createSignatureProof(options) {
    return {
        trustModel: 'reputational',
        mechanism: 'signature',
        algorithm: 'ECDSA_secp256k1',
        signerPublicKey: options.signerPublicKey,
        publicKeySource: options.publicKeySource,
        signerIdentity: options.signerIdentity,
        signature: options.signature,
    };
}
/**
 * Get the canonical data that should be signed for a claim.
 *
 * External systems that need to sign claims outside this library
 * should use this function to get the exact bytes to sign.
 *
 * @param claim - The claim to get signing data for
 * @returns Canonical JSON string to be signed
 */
export function getClaimSigningData(claim) {
    return canonicalizeClaimForSigning(claim);
}
//# sourceMappingURL=signature.js.map