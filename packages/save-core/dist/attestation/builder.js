/**
 * AttestationBuilder - Fluent API for creating attestations
 */
import { assertHexString } from '../types/common.js';
import { ClaimDAG } from '../dag/claim-dag.js';
import { sign, hashObject, getPublicKey, deterministicId, canonicalize } from '../crypto/ecdsa.js';
import { SAVE_VERSION, SAVE_SCHEMA, checkAttestationVersion } from '../version.js';
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
    issuer;
    createdAt;
    publicKeySource;
    expiresAt;
    proofId;
    dag;
    constructor(options) {
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
    addClaim(claim) {
        this.dag.addClaim(claim);
        return this;
    }
    /**
     * Add multiple claims at once
     * @param claims - Array of claims to add
     * @returns this (for chaining)
     */
    addClaims(claims) {
        for (const claim of claims) {
            this.addClaim(claim);
        }
        return this;
    }
    /**
     * Get the underlying DAG for inspection
     */
    getDAG() {
        return this.dag;
    }
    /**
     * Build the unsigned attestation data
     * All claims are already resolved incrementally as they were added to the DAG
     */
    buildUnsigned(publicKey) {
        const claims = this.dag.toClaimData();
        if (claims.length === 0) {
            throw new Error('Attestation must contain at least one claim');
        }
        // Derive attestationId deterministically from createdAt + claims content
        const attestationId = deterministicId(this.createdAt + canonicalize(claims));
        const unsigned = {
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
    sign(privateKey) {
        const publicKey = getPublicKey(privateKey);
        const unsigned = this.buildUnsigned(publicKey);
        // Create signature over the attestation content
        const signedDataHash = hashObject({
            metadata: unsigned.metadata,
            claims: unsigned.claims,
        });
        const signatureValue = sign(signedDataHash, privateKey);
        const signature = {
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
    data;
    constructor(data) {
        this.data = data;
    }
    /** Get attestation ID */
    get id() {
        return this.data.metadata.attestationId;
    }
    /** Get issuer information */
    get issuer() {
        return this.data.metadata.issuer;
    }
    /** Get creation timestamp */
    get createdAt() {
        return this.data.metadata.createdAt;
    }
    /** Get expiration timestamp */
    get expiresAt() {
        return this.data.metadata.expiresAt;
    }
    /** Get all claims */
    get claims() {
        return this.data.claims;
    }
    /** Get the raw attestation data */
    toData() {
        return this.data;
    }
    /** Serialize to JSON string */
    toJSON() {
        return JSON.stringify(this.data, null, 2);
    }
    /**
     * Export to a file
     * @param path - File path to write to
     */
    async exportToFile(path) {
        const fs = await import('fs/promises');
        await fs.writeFile(path, this.toJSON(), 'utf-8');
    }
    /**
     * Load an attestation from a file
     * @param path - File path to read from
     */
    static async fromFile(path) {
        const fs = await import('fs/promises');
        const content = await fs.readFile(path, 'utf-8');
        return Attestation.fromJSON(content);
    }
    /**
     * Parse attestation from JSON string
     * @param json - JSON string
     */
    static fromJSON(json) {
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
        }
        catch (error) {
            throw new Error(`Invalid attestation: ${error instanceof Error ? error.message : 'signature validation failed'}`);
        }
        return new Attestation(data);
    }
}
//# sourceMappingURL=builder.js.map