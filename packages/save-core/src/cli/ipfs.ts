/**
 * IPFS upload and CID utilities
 */

import type { VerificationData } from '../types/index.js';
import { sortObjectKeys } from '../utils/sort.js';

/**
 * Base58 alphabet for IPFS CIDs
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode a base58 string to bytes
 */
export function base58Decode(source: string): Uint8Array {
  if (source.length === 0) return new Uint8Array(0);
  
  // Count leading zeros
  let zeros = 0;
  let length = 0;
  let pbegin = 0;
  const pend = source.length;
  
  while (source[pbegin] === '1') {
    pbegin++;
    zeros++;
  }
  
  // Allocate enough space in big-endian base256 representation
  const size = ((pend - pbegin) * 733 / 1000 + 1) >>> 0;
  const b256 = new Uint8Array(size);
  
  // Process the characters
  while (pbegin !== pend) {
    const ch = source[pbegin];
    let carry = BASE58_ALPHABET.indexOf(ch);
    
    if (carry === -1) throw new Error('Invalid base58 character');
    
    // Apply "b256 = b256 * 58 + carry"
    let i = 0;
    for (let it = size - 1; (carry !== 0 || i < length) && (it !== -1); it--, i++) {
      carry += (58 * b256[it]) >>> 0;
      b256[it] = (carry % 256) >>> 0;
      carry = (carry / 256) >>> 0;
    }
    
    if (carry !== 0) throw new Error('Non-zero carry');
    length = i;
    pbegin++;
  }
  
  // Skip leading zeros in base256 result
  let it = size - length;
  while (it !== size && b256[it] === 0) {
    it++;
  }
  
  // Prepend leading zeros
  const result = new Uint8Array(zeros + (size - it));
  result.fill(0, 0, zeros);
  
  let resultIndex = zeros;
  for (; it < size; ++it) {
    result[resultIndex++] = b256[it];
  }
  
  return result;
}

/**
 * Convert IPFS CID to bytes32 hash
 */
export function ipfsCidToHash(cid: string): string {
  // Decode base58
  const bytes = base58Decode(cid);
  
  // Check multihash prefix (0x1220 = SHA-256, 32 bytes)
  if (bytes.length < 34) {
    throw new Error('Invalid IPFS CID: too short');
  }
  
  if (bytes[0] !== 0x12 || bytes[1] !== 0x20) {
    throw new Error('Invalid IPFS CID: expected SHA-256 multihash prefix (0x1220)');
  }
  
  // Extract the 32-byte hash (skip the 2-byte prefix)
  const hash = bytes.slice(2, 34);
  
  // Convert to hex string
  let hex = '0x';
  for (let i = 0; i < hash.length; i++) {
    hex += hash[i].toString(16).padStart(2, '0');
  }
  
  return hex;
}

/**
 * Push verification to IPFS using Kubo API
 */
export async function pushToIpfs(
  verification: VerificationData,
  ipfsUrl: string,
  username?: string,
  password?: string
): Promise<string> {
  const jsonString = JSON.stringify(sortObjectKeys(verification), null, 2);
  
  // Create multipart/form-data body
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const multipartBody = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="verification.json"`,
    `Content-Type: application/json`,
    ``,
    jsonString,
    `--${boundary}--`,
    ``
  ].join('\r\n');

  // Create headers
  const headers: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  };

  // Add Basic Auth for Kubo if credentials provided
  if (username && password) {
    const authCredentials = `${username}:${password}`;
    headers['Authorization'] = `Basic ${Buffer.from(authCredentials).toString('base64')}`;
  }

  const response = await fetch(`${ipfsUrl}/api/v0/add`, {
    method: 'POST',
    headers,
    body: multipartBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`IPFS upload failed (${response.status} ${response.statusText}): ${errorText}`);
  }

  const result = (await response.json()) as { Hash: string };
  return result.Hash;
}
