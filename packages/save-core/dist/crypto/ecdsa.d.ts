/**
 * ECDSA cryptographic utilities using secp256k1 curve
 */
import type { HexString } from '../types/index.js';
/**
 * Generate a deterministic UUID from a seed string.
 * Hashes the seed with SHA-256 and formats the first 16 bytes as a UUID v5-style identifier.
 * Identical seeds always produce identical UUIDs.
 */
export declare function deterministicId(seed: string): string;
/**
 * Generate a new ECDSA key pair
 * @returns Object with private key and public key in hex format
 */
export declare function generateKeyPair(): {
    privateKey: HexString;
    publicKey: HexString;
};
/**
 * Derive public key from private key
 * @param privateKey - Private key in hex format
 * @returns Public key in hex format (compressed)
 */
export declare function getPublicKey(privateKey: HexString): HexString;
/**
 * Hash data using SHA-256
 * @param data - Data to hash (string or bytes)
 * @returns Hash in hex format
 */
export declare function hashData(data: string | Uint8Array): HexString;
/**
 * Sign data using ECDSA
 * @param data - Data to sign (will be hashed with SHA-256)
 * @param privateKey - Private key in hex format
 * @returns Signature in hex format
 */
export declare function sign(data: string | Uint8Array, privateKey: HexString): HexString;
/**
 * Verify an ECDSA signature
 * @param data - Original data that was signed
 * @param signature - Signature to verify (compact format)
 * @param publicKey - Public key of the signer
 * @returns True if signature is valid
 */
export declare function verify(data: string | Uint8Array, signature: HexString, publicKey: HexString): boolean;
export { sortObjectKeys } from '../utils/sort.js';
/**
 * Serialize data to a canonical JSON string for signing.
 * Deep-sorts all object keys for deterministic output.
 * @param data - Data to serialize
 * @returns Canonical JSON string
 */
export declare function canonicalize(data: unknown): string;
/**
 * Create a canonical hash of an object
 * @param obj - Object to hash
 * @returns SHA-256 hash of the canonicalized object
 */
export declare function hashObject(obj: unknown): HexString;
//# sourceMappingURL=ecdsa.d.ts.map