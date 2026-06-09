/**
 * AttestationBuilder - Fluent API for creating attestations
 */

import type {
  HexString,
  Issuer,
  AttestationData,
  UnsignedAttestationData,
  Signature,
} from '../types/index.js';
import { assertHexString } from '../types/common.js';
import { ClaimDAG } from '../dag/claim-dag.js';
import { NumericClaim, ObjectClaim, StringClaim } from '../claims/index.js';
import { sign, hashObject, getPublicKey, deterministicId, canonicalize } from '../crypto/ecdsa.js';
import { SAVE_VERSION, SAVE_SCHEMA, checkAttestationVersion } from '../version.js';

/** Supported claim types */
type Claim = NumericClaim | ObjectClaim | StringClaim;

/** Options for initializing the attestation builder */
export interface AttestationBuilderOptions {
  /** Information about the issuer */
  issuer: Omit<Issuer, 'publicKey'>;
  /** Creation timestamp (ISO 8601). Must be provided externally for deterministic output. */
  createdAt: string;
  /** URL where the issuer's public key can be independently verified */
  publicKeySource?: string;
  /** Expiration timestamp */
  expiresAt?: string;
  /** Proof ID this attestation belongs to */
  proofId?: string;
}

/**
 * AttestationBuilder provides a fluent API for constructing attestations.
 * 
 * Usage:
 * ```typescript
 * const attestation = await new AttestationBuilder({ issuer: {...} })
 *   .addClaim(claim1)
 *   .addClaim(claim2)
 *   .sign(privateKey);
 * ```
 */
export class AttestationBuilder {
  private readonly issuer: Omit<Issuer, 'publicKey'>;
  private readonly createdAt: string;
  private readonly publicKeySource?: string;
  private readonly expiresAt?: string;
  private readonly proofId?: string;
  private readonly dag: ClaimDAG;

  constructor(options: AttestationBuilderOptions) {
    this.issuer = options.issuer;
    this.createdAt = options.createdAt;
    this.publicKeySource = options.publicKeySource;
    this.expiresAt = options.expiresAt;
    this.proofId = options.proofId;
    this.dag = new ClaimDAG();
  }

  /**
   * Add a claim to the attestation
   * @param claim - The claim to add
   * @returns this (for chaining)
   */
  addClaim(claim: Claim): this {
    this.dag.addClaim(claim);
    return this;
  }

  /**
   * Add multiple claims at once
   * @param claims - Array of claims to add
   * @returns this (for chaining)
   */
  addClaims(claims: Claim[]): this {
    for (const claim of claims) {
      this.addClaim(claim);
    }
    return this;
  }

  /**
   * Get the underlying DAG for inspection
   */
  getDAG(): ClaimDAG {
    return this.dag;
  }


  /**
   * Build the unsigned attestation data
   * All claims are already resolved incrementally as they were added to the DAG
   */
  private buildUnsigned(publicKey: HexString): UnsignedAttestationData {
    const claims = this.dag.toClaimData();

    if (claims.length === 0) {
      throw new Error('Attestation must contain at least one claim');
    }

    // Derive attestationId deterministically from createdAt + claims content
    const attestationId = deterministicId(this.createdAt + canonicalize(claims));

    const unsigned: UnsignedAttestationData = {
      metadata: {
        version: SAVE_VERSION,
        schema: SAVE_SCHEMA,
        issuer: {
          ...this.issuer,
          publicKey: publicKey,
        },
        createdAt: this.createdAt,
        expiresAt: this.expiresAt,
        attestationId: attestationId,
        proofId: this.proofId,
      },
      claims,
    };

    return unsigned;
  }

  /**
   * Sign the attestation with the issuer's private key
   * @param privateKey - Issuer's private key in hex format
   * @returns Complete signed attestation
   */
  sign(privateKey: HexString): Attestation {
    const publicKey = getPublicKey(privateKey);
    const unsigned = this.buildUnsigned(publicKey);

    // Create signature over the attestation content
    const signedDataHash = hashObject({
      metadata: unsigned.metadata,
      claims: unsigned.claims,
    });

    const signatureValue = sign(signedDataHash, privateKey);

    const signature: Signature = {
      algorithm: 'ECDSA_secp256k1',
      publicKey: publicKey,
      publicKeySource: this.publicKeySource,
      signature: signatureValue,
      signedData: signedDataHash,
    };

    return new Attestation({
      ...unsigned,
      signature,
    });
  }
}

/**
 * Attestation represents a complete, signed attestation document.
 */
export class Attestation {
  private readonly data: AttestationData;

  constructor(data: AttestationData) {
    this.data = data;
  }

  /** Get attestation ID */
  get id(): string {
    return this.data.metadata.attestationId;
  }

  /** Get issuer information */
  get issuer(): Issuer {
    return this.data.metadata.issuer;
  }

  /** Get creation timestamp */
  get createdAt(): string {
    return this.data.metadata.createdAt;
  }

  /** Get expiration timestamp */
  get expiresAt(): string | undefined {
    return this.data.metadata.expiresAt;
  }

  /** Get all claims */
  get claims(): AttestationData['claims'] {
    return this.data.claims;
  }


  /** Get the raw attestation data */
  toData(): AttestationData {
    return this.data;
  }

  /** Serialize to JSON string */
  toJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Export to a file
   * @param path - File path to write to
   */
  async exportToFile(path: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(path, this.toJSON(), 'utf-8');
  }

  /**
   * Load an attestation from a file
   * @param path - File path to read from
   */
  static async fromFile(path: string): Promise<Attestation> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(path, 'utf-8');
    return Attestation.fromJSON(content);
  }

  /**
   * Parse attestation from JSON string
   * @param json - JSON string
   */
  static fromJSON(json: string): Attestation {
    const data = JSON.parse(json);
    
    // Validate required top-level fields
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid attestation: not an object');
    }
    if (!data.metadata || typeof data.metadata !== 'object') {
      throw new Error('Invalid attestation: missing or invalid metadata');
    }
    if (!Array.isArray(data.claims)) {
      throw new Error('Invalid attestation: claims must be an array');
    }
    if (!data.signature || typeof data.signature !== 'object') {
      throw new Error('Invalid attestation: missing or invalid signature');
    }
    
    // Validate schema/version compatibility
    checkAttestationVersion(data.metadata.schema, data.metadata.version);

    // Validate metadata required fields
    if (!data.metadata.attestationId || typeof data.metadata.attestationId !== 'string') {
      throw new Error('Invalid attestation: metadata.attestationId must be a string');
    }
    if (!data.metadata.createdAt || typeof data.metadata.createdAt !== 'string') {
      throw new Error('Invalid attestation: metadata.createdAt must be a string');
    }
    
    // Validate signature hex strings
    try {
      assertHexString(data.signature.publicKey, 'signature.publicKey');
      assertHexString(data.signature.signature, 'signature.signature');
      assertHexString(data.signature.signedData, 'signature.signedData');
    } catch (error) {
      throw new Error(`Invalid attestation: ${error instanceof Error ? error.message : 'signature validation failed'}`);
    }
    
    return new Attestation(data as AttestationData);
  }
}
