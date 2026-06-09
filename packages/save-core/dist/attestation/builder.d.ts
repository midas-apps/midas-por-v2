/**
 * AttestationBuilder - Fluent API for creating attestations
 */
import type { HexString, Issuer, AttestationData } from '../types/index.js';
import { ClaimDAG } from '../dag/claim-dag.js';
import { NumericClaim, ObjectClaim, StringClaim } from '../claims/index.js';
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
export declare class AttestationBuilder {
    private readonly issuer;
    private readonly createdAt;
    private readonly publicKeySource?;
    private readonly expiresAt?;
    private readonly proofId?;
    private readonly dag;
    constructor(options: AttestationBuilderOptions);
    /**
     * Add a claim to the attestation
     * @param claim - The claim to add
     * @returns this (for chaining)
     */
    addClaim(claim: Claim): this;
    /**
     * Add multiple claims at once
     * @param claims - Array of claims to add
     * @returns this (for chaining)
     */
    addClaims(claims: Claim[]): this;
    /**
     * Get the underlying DAG for inspection
     */
    getDAG(): ClaimDAG;
    /**
     * Build the unsigned attestation data
     * All claims are already resolved incrementally as they were added to the DAG
     */
    private buildUnsigned;
    /**
     * Sign the attestation with the issuer's private key
     * @param privateKey - Issuer's private key in hex format
     * @returns Complete signed attestation
     */
    sign(privateKey: HexString): Attestation;
}
/**
 * Attestation represents a complete, signed attestation document.
 */
export declare class Attestation {
    private readonly data;
    constructor(data: AttestationData);
    /** Get attestation ID */
    get id(): string;
    /** Get issuer information */
    get issuer(): Issuer;
    /** Get creation timestamp */
    get createdAt(): string;
    /** Get expiration timestamp */
    get expiresAt(): string | undefined;
    /** Get all claims */
    get claims(): AttestationData['claims'];
    /** Get the raw attestation data */
    toData(): AttestationData;
    /** Serialize to JSON string */
    toJSON(): string;
    /**
     * Export to a file
     * @param path - File path to write to
     */
    exportToFile(path: string): Promise<void>;
    /**
     * Load an attestation from a file
     * @param path - File path to read from
     */
    static fromFile(path: string): Promise<Attestation>;
    /**
     * Parse attestation from JSON string
     * @param json - JSON string
     */
    static fromJSON(json: string): Attestation;
}
export {};
//# sourceMappingURL=builder.d.ts.map