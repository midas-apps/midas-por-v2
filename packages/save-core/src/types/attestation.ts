/**
 * Attestation types for SAVE
 *
 * An Attestation is a cryptographically signed document containing
 * one or more Claims about verifiable facts.
 *
 * Claims of type "object" serve as proven data containers that
 * other claims can reference via pointers.
 */

import type { Issuer, Signature, Timestamp } from './common.js';
import type { ClaimData } from './claim.js';

/** Attestation metadata */
export interface AttestationMetadata {
  /** Schema version */
  version: string;
  /** Schema identifier */
  schema: string;
  /** Information about the attestation issuer */
  issuer: Issuer;
  /** When the attestation was created */
  createdAt: Timestamp;
  /** When the attestation expires (optional) */
  expiresAt?: Timestamp;
  /** Unique identifier for this attestation */
  attestationId: string;
  /** Proof ID this attestation belongs to (for on-chain registration) */
  proofId?: string;
}

/** Complete attestation document */
export interface AttestationData {
  /** Attestation metadata */
  metadata: AttestationMetadata;
  /** Array of claims in the attestation */
  claims: ClaimData[];
  /** Cryptographic signature over the attestation */
  signature: Signature;
}

/** Unsigned attestation (before signing) */
export interface UnsignedAttestationData {
  /** Attestation metadata */
  metadata: AttestationMetadata;
  /** Array of claims in the attestation */
  claims: ClaimData[];
}
