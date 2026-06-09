/**
 * Common types used throughout the SAVE library
 */
/** Unique identifier for a claim */
export type ClaimId = string;
/** Hexadecimal string representation */
export type HexString = `0x${string}`;
/**
 * Runtime validation for HexString.
 * Checks that the string starts with '0x' and contains only valid hex characters.
 * @throws {Error} If the string is not a valid hex string
 */
export declare function assertHexString(value: unknown, fieldName?: string): asserts value is HexString;
/**
 * Type guard for HexString with runtime validation.
 * Returns true if the value is a valid hex string, false otherwise.
 */
export declare function isHexString(value: unknown): value is HexString;
/** ISO 8601 timestamp string */
export type Timestamp = string;
/** Supported signature algorithms */
export type SignatureAlgorithm = 'ECDSA_secp256k1' | 'Ed25519' | 'BLS';
/** Issuer identity information */
export interface Issuer {
    /** Unique identifier for the issuer (e.g., address or DID) */
    identity: string;
    /** Public key in hex format */
    publicKey: HexString;
    /** Human-readable name */
    name: string;
}
/** Cryptographic signature */
export interface Signature {
    /** Algorithm used for signing */
    algorithm: SignatureAlgorithm;
    /** Public key of the signer */
    publicKey: HexString;
    /** URL where the public key can be independently verified */
    publicKeySource?: string;
    /** The signature value */
    signature: HexString;
    /** Hash of the signed data */
    signedData: HexString;
}
/** HTTP response from an HttpClient */
export interface HttpResponse {
    /** HTTP status code */
    status: number;
    /** Response body as string */
    body: string;
}
/**
 * Generic HTTP client interface for making requests during verification.
 * Implementations can wrap fetch(), CRE's HTTPClient, or any other HTTP library.
 */
export interface HttpClient {
    post(url: string, body: string, headers: Record<string, string>): Promise<HttpResponse>;
}
/**
 * Default HttpClient implementation using fetch().
 * Used automatically when no custom HttpClient is provided (e.g. CLI usage).
 */
export declare class FetchHttpClient implements HttpClient {
    post(url: string, body: string, headers: Record<string, string>): Promise<HttpResponse>;
}
//# sourceMappingURL=common.d.ts.map