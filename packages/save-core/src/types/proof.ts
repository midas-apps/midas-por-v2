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

import type { HexString, SignatureAlgorithm } from './common.js';

// =============================================================================
// Trust Model (what you ultimately trust)
// =============================================================================

/** Canonical trust model */
export type TrustModel =
  | 'reputational'
  | 'mathematical'
  | 'computation';

// =============================================================================
// Assurance Mechanisms (how evidence is provided)
// =============================================================================

/** Mechanisms typically used with the reputational trust model */
export type ReputationalMechanism = 'signature' | 'multisig' | 'oracle' | 'api' | 'document';

/**
 * Signature proof - a trusted party signs the claim
 */
interface SignatureProofCommon {
  /** Algorithm used for the signature */
  algorithm: SignatureAlgorithm;
  /** Public key of the signer (used to verify signature) */
  signerPublicKey: HexString;
  /** URL where the public key can be independently verified */
  publicKeySource?: string;
  /** Human-readable identity of the signer */
  signerIdentity: string;
  /** The signature over the canonicalized claim */
  signature: HexString;
}

// =============================================================================
// Mathematical Proofs - Verifiable mathematical properties
// =============================================================================

/** Mechanisms typically used with the mathematical trust model */
export type MathematicalMechanism = 
  | 'zk_tls_notary';     // ZK-TLS Notary proofs (cryptographic proof of web data)

// =============================================================================
// Computation Proofs - Verifiable execution / workflows
// =============================================================================

/** Mechanisms typically used with the computation trust model */
export type ComputationMechanism = 
  | 'cre_consensus'     // Chainlink Runtime Environment consensus
  | (string & {});      // Allow custom computation mechanisms (string & {} preserves autocomplete)

/** Union of known mechanisms (used for tagging) */
export type ProofMechanism =
  | ReputationalMechanism
  | MathematicalMechanism
  | ComputationMechanism;

// =============================================================================
// Concrete Proof Types
// =============================================================================

export interface SignatureProofData extends SignatureProofCommon {
  trustModel: 'reputational';
  mechanism: 'signature';
}

/**
 * ZK-TLS Notary proof - cryptographic proof of web data using TLS session attestation
 * 
 * Vlayer implementation (currently the only supported provider):
 * - Verification endpoint: https://web-prover.production.vlayer.xyz/api/v2.0/verify
 * - Validation: POST the raw proof data to the endpoint and verify response matches stored data
 */
export interface ZkTlsNotaryProofData {
  trustModel: 'mathematical';
  mechanism: 'zk_tls_notary';
  /** Platform that generated the proof (currently only 'vlayer' is supported) */
  platform: 'vlayer';
  /** Vlayer raw proof data (may contain additional provider-specific fields) */
  proof: {
    /** The encoded proof data */
    data: string;
    /** Proof version/format */
    version: string;
    /** Metadata about the proof */
    meta: {
      /** Notary server URL that witnessed the TLS session */
      notaryUrl: string;
    };
    /** Vlayer may return additional fields (e.g. traceId) that are preserved for proof replay */
    [key: string]: unknown;
  };
  /** 
   * Vlayer verification endpoint URL
   * Defaults to: https://web-prover.production.vlayer.xyz/api/v2.0/verify
   */
  verificationEndpoint: string;
  /** Server domain that was proven (e.g., mail.google.com) */
  serverDomain: string;
  /** Notary public key fingerprint (for additional validation) */
  notaryKeyFingerprint: string;
}

/**
 * CRE Consensus proof - data verified through Chainlink Runtime Environment consensus
 * 
 * Used for data fetched via CRE workflows where multiple DON nodes independently
 * execute the same operation and reach consensus on the result.
 * 
 * TODO: Add metadata fields (source, timestamp, etc.) for proof context
 */
export interface CreConsensusProofData {
  trustModel: 'computation';
  mechanism: 'cre_consensus';
}

// =============================================================================
// Union of All Proof Types
// =============================================================================

/** Union of all supported proof types */
export type ProofData = SignatureProofData | ZkTlsNotaryProofData | CreConsensusProofData;

// =============================================================================
// Type Guards
// =============================================================================

/** Type guard for signature proof */
export function isSignatureProof(proof: ProofData): proof is SignatureProofData {
  return proof.trustModel === 'reputational' && proof.mechanism === 'signature';
}

/** Type guard for ZK-TLS Notary proof */
export function isZkTlsNotaryProof(proof: ProofData): proof is ZkTlsNotaryProofData {
  return proof.trustModel === 'mathematical' && proof.mechanism === 'zk_tls_notary';
}

/** Type guard for CRE Consensus proof */
export function isCreConsensusProof(proof: ProofData): proof is CreConsensusProofData {
  return proof.trustModel === 'computation' && proof.mechanism === 'cre_consensus';
}
