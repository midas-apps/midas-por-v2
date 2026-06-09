/**
 * Proof types for SAVE
 *
 * Proofs provide evidence that a claim's value is valid.
 *
 * The SAVE library separates:
 *
 * 1. **Trust model** (`trustModel`) - what you ultimately trust for correctness
 *    - `reputational`: Trust a specific identity's assertion (person, organization, API operator)
 *    - `mathematical`: Trust mathematical verification (ZK proofs, Merkle trees, state proofs)
 *    - `computation`: Trust an execution environment or process (TEE, CRE workflows, blockchain consensus)
 *
 * 2. **Assurance mechanism** (`mechanism`) - how the claim is evidenced / verified
 *
 * @see README.md for the full proof hierarchy
 */
// =============================================================================
// Type Guards
// =============================================================================
/** Type guard for signature proof */
export function isSignatureProof(proof) {
    return proof.trustModel === 'reputational' && proof.mechanism === 'signature';
}
/** Type guard for ZK-TLS Notary proof */
export function isZkTlsNotaryProof(proof) {
    return proof.trustModel === 'mathematical' && proof.mechanism === 'zk_tls_notary';
}
/** Type guard for CRE Consensus proof */
export function isCreConsensusProof(proof) {
    return proof.trustModel === 'computation' && proof.mechanism === 'cre_consensus';
}
//# sourceMappingURL=proof.js.map