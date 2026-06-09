/**
 * ECDSA cryptographic utilities using secp256k1 curve
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
/** Ensure hex string has 0x prefix */
function ensureHexPrefix(hex) {
    if (hex.startsWith('0x')) {
        return hex;
    }
    return `0x${hex}`;
}
/** Remove 0x prefix from hex string */
function stripHexPrefix(hex) {
    if (hex.startsWith('0x')) {
        return hex.slice(2);
    }
    return hex;
}
/**
 * Generate a deterministic UUID from a seed string.
 * Hashes the seed with SHA-256 and formats the first 16 bytes as a UUID v5-style identifier.
 * Identical seeds always produce identical UUIDs.
 */
export function deterministicId(seed) {
    const hash = sha256(new TextEncoder().encode(seed));
    const bytes = hash.slice(0, 16);
    // Set version (5) and variant bits for UUID format
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // Version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
/**
 * Generate a new ECDSA key pair
 * @returns Object with private key and public key in hex format
 */
export function generateKeyPair() {
    const privateKeyBytes = randomBytes(32);
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true); // compressed
    return {
        privateKey: ensureHexPrefix(bytesToHex(privateKeyBytes)),
        publicKey: ensureHexPrefix(bytesToHex(publicKeyBytes)),
    };
}
/**
 * Derive public key from private key
 * @param privateKey - Private key in hex format
 * @returns Public key in hex format (compressed)
 */
export function getPublicKey(privateKey) {
    const privateKeyBytes = hexToBytes(stripHexPrefix(privateKey));
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true);
    return ensureHexPrefix(bytesToHex(publicKeyBytes));
}
/**
 * Hash data using SHA-256
 * @param data - Data to hash (string or bytes)
 * @returns Hash in hex format
 */
export function hashData(data) {
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBytes = sha256(dataBytes);
    return ensureHexPrefix(bytesToHex(hashBytes));
}
/**
 * Sign data using ECDSA
 * @param data - Data to sign (will be hashed with SHA-256)
 * @param privateKey - Private key in hex format
 * @returns Signature in hex format
 */
export function sign(data, privateKey) {
    const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hash = sha256(dataBytes);
    const privateKeyBytes = hexToBytes(stripHexPrefix(privateKey));
    const signature = secp256k1.sign(hash, privateKeyBytes);
    return ensureHexPrefix(bytesToHex(signature.toCompactRawBytes()));
}
/**
 * Verify an ECDSA signature
 * @param data - Original data that was signed
 * @param signature - Signature to verify (compact format)
 * @param publicKey - Public key of the signer
 * @returns True if signature is valid
 */
export function verify(data, signature, publicKey) {
    try {
        const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const hash = sha256(dataBytes);
        const signatureHex = stripHexPrefix(signature);
        const publicKeyBytes = hexToBytes(stripHexPrefix(publicKey));
        // Reconstruct signature from compact hex format
        const sig = secp256k1.Signature.fromCompact(signatureHex);
        // Verify using DER format bytes
        return secp256k1.verify(sig.toDERRawBytes(), hash, publicKeyBytes);
    }
    catch {
        return false;
    }
}
// Re-export sortObjectKeys from utils for backward compatibility
export { sortObjectKeys } from '../utils/sort.js';
import { sortObjectKeys } from '../utils/sort.js';
/**
 * Serialize data to a canonical JSON string for signing.
 * Deep-sorts all object keys for deterministic output.
 * @param data - Data to serialize
 * @returns Canonical JSON string
 */
export function canonicalize(data) {
    return JSON.stringify(sortObjectKeys(data));
}
/**
 * Create a canonical hash of an object
 * @param obj - Object to hash
 * @returns SHA-256 hash of the canonicalized object
 */
export function hashObject(obj) {
    const sorted = sortObjectKeys(obj);
    const json = JSON.stringify(sorted);
    return hashData(json);
}
//# sourceMappingURL=ecdsa.js.map