#!/usr/bin/env node
/**
 * SAVE CLI - Verify Attestation (orchestrator)
 *
 * Command-line tool to verify SAVE attestation files.
 * Delegates to:
 *   - cli/args.ts    — argument parsing & env loading
 *   - cli/ipfs.ts    — IPFS upload & CID utilities
 *   - cli/onchain.ts — on-chain contract interaction
 *
 * Usage:
 *   save-verify <attestation.json> [options]
 */
export { parseArgs, loadEnvFile } from './args.js';
export { base58Decode, ipfsCidToHash } from './ipfs.js';
export type { CLIOptions } from './args.js';
//# sourceMappingURL=verify.d.ts.map