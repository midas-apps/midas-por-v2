/**
 * SAVE - Structured Attestation & Verification Engine
 *
 * A library for creating cryptographically signed attestations
 * with verifiable claims organized in a DAG structure.
 *
 * Each Proof has several Attestations over time,
 * and each Attestation has several Verifications.
 */
export { SAVE_VERSION, SAVE_SCHEMA, checkAttestationVersion } from './version.js';
export * from './types/index.js';
export { NumericClaim, createNumericClaim, StringClaim, createStringClaim, ObjectClaim, extractFromStructuredText, resolveObjectPointer, } from './claims/index.js';
export type { CreateNumericClaimOptions, InlineNumericClaimOptions, SourceBackedNumericClaimOptions, AggregatedNumericClaimOptions, CreateStringClaimOptions, InlineStringClaimOptions, SourceBackedStringClaimOptions, ObjectClaimOptions, StructuredTextClaimOptions, } from './claims/index.js';
export { signClaim, createSignatureProof, getClaimSigningData, verifyZkTlsNotaryProof, createVlayerProof, } from './proofs/index.js';
export type { SignClaimOptions, ZkTlsNotaryVerificationResult, VerifyZkTlsNotaryOptions, } from './proofs/index.js';
export { sum, subtract, executeNumericAggregation } from './aggregation/index.js';
export { ClaimDAG } from './dag/index.js';
export { AttestationBuilder, Attestation } from './attestation/index.js';
export type { AttestationBuilderOptions } from './attestation/index.js';
export { generateKeyPair, getPublicKey, hashData, sign, verify, hashObject, deterministicId, } from './crypto/index.js';
export { verifyAttestation, registerProofVerifier } from './verification/index.js';
export type { VerifyAttestationOptions, VlayerCredentials, ProofVerifierFn } from './verification/index.js';
export { FetchHttpClient, assertHexString, isHexString } from './types/common.js';
export type { HttpClient, HttpResponse } from './types/common.js';
//# sourceMappingURL=index.d.ts.map