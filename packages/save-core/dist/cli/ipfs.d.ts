/**
 * IPFS upload and CID utilities
 */
import type { VerificationData } from '../types/index.js';
/**
 * Decode a base58 string to bytes
 */
export declare function base58Decode(source: string): Uint8Array;
/**
 * Convert IPFS CID to bytes32 hash
 */
export declare function ipfsCidToHash(cid: string): string;
/**
 * Push verification to IPFS using Kubo API
 */
export declare function pushToIpfs(verification: VerificationData, ipfsUrl: string, username?: string, password?: string): Promise<string>;
//# sourceMappingURL=ipfs.d.ts.map