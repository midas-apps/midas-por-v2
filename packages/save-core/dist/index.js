/**
 * SAVE - Structured Attestation & Verification Engine
 *
 * A library for creating cryptographically signed attestations
 * with verifiable claims organized in a DAG structure.
 *
 * Each Proof has several Attestations over time,
 * and each Attestation has several Verifications.
 */
// Version info
export { SAVE_VERSION, SAVE_SCHEMA, checkAttestationVersion } from './version.js';
// Core types
export * from './types/index.js';
// Claim types and utilities
export { NumericClaim, createNumericClaim, StringClaim, createStringClaim, ObjectClaim, extractFromStructuredText, resolveObjectPointer, } from './claims/index.js';
// Proof utilities
export { signClaim, createSignatureProof, getClaimSigningData, verifyZkTlsNotaryProof, createVlayerProof, } from './proofs/index.js';
// Aggregation functions
export { sum, subtract, executeNumericAggregation } from './aggregation/index.js';
// DAG
export { ClaimDAG } from './dag/index.js';
// Attestation builder
export { AttestationBuilder, Attestation } from './attestation/index.js';
// Cryptographic utilities
export { generateKeyPair, getPublicKey, hashData, sign, verify, hashObject, deterministicId, } from './crypto/index.js';
// Verification
export { verifyAttestation, registerProofVerifier } from './verification/index.js';
// HTTP client interface (for custom implementations, e.g. CRE)
export { FetchHttpClient, assertHexString, isHexString } from './types/common.js';
//# sourceMappingURL=index.js.map