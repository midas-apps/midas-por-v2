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

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { AttestationData, Verifier, HexString } from '../types/index.js';
import { verifyAttestation } from '../verification/index.js';
import { generateKeyPair, getPublicKey } from '../crypto/ecdsa.js';
import { parseArgs, loadEnvFile } from './args.js';
import { pushToIpfs, ipfsCidToHash } from './ipfs.js';
import { setVerification, fetchLatestAttestation } from './onchain.js';

// Re-export for backward compatibility / tests
export { parseArgs, loadEnvFile } from './args.js';
export { base58Decode, ipfsCidToHash } from './ipfs.js';
export type { CLIOptions } from './args.js';

/**
 * Main CLI function
 */
async function main() {
  try {
    // Parse arguments (skip node and script name)
    const options = parseArgs(process.argv.slice(2));

    // Load environment variables from file if specified
    let envVars: Record<string, string> = {};
    if (options.envFile) {
      if (options.verbose) {
        console.log(`Loading environment from: ${options.envFile}`);
      }
      envVars = loadEnvFile(options.envFile);
    }

    // Apply env file values as defaults (CLI args take precedence)
    options.ipfsUrl = options.ipfsUrl || envVars.IPFS_URL;
    options.ipfsUsername = options.ipfsUsername || envVars.IPFS_USERNAME;
    options.ipfsPassword = options.ipfsPassword || envVars.IPFS_PASSWORD;
    options.privateKey = options.privateKey || envVars.DEPLOYER_PRIVATE_KEY || envVars.PRIVATE_KEY;
    options.rpcUrl = options.rpcUrl || envVars.RPC_URL;
    options.registry = options.registry || envVars.REGISTRY_ADDRESS;
    options.vlayerClientId = options.vlayerClientId || envVars.VLAYER_CLIENT_ID;
    options.vlayerAuthToken = options.vlayerAuthToken || envVars.VLAYER_AUTH_TOKEN;

    // Validate input
    if (!options.input) {
      console.error('Error: No input file specified\n');
      const { printHelp } = await import('./args.js');
      printHelp();
      process.exit(1);
    }

    // Resolve paths
    const inputPath = resolve(options.input);
    const outputPath = resolve(options.output || 'verification.json');

    if (options.verbose) {
      console.log('SAVE Attestation Verifier');
      console.log('='.repeat(50));
      console.log(`Input:  ${inputPath}`);
      console.log(`Output: ${outputPath}\n`);
    }

    // Read attestation file
    if (options.verbose) {
      console.log('Reading attestation...');
    }
    
    const attestationJson = await readFile(inputPath, 'utf-8');
    const attestation: AttestationData = JSON.parse(attestationJson);

    // Generate or use provided verifier keys
    let verifierPrivateKey: string;
    let verifierPublicKey: string;
    
    if (options.verifierKey) {
      verifierPrivateKey = options.verifierKey.startsWith('0x') ? options.verifierKey : `0x${options.verifierKey}`;
      verifierPublicKey = getPublicKey(verifierPrivateKey as HexString);
    } else {
      if (options.verbose) {
        console.log('Generating verifier key pair...');
      }
      const keyPair = generateKeyPair();
      verifierPrivateKey = keyPair.privateKey;
      verifierPublicKey = keyPair.publicKey;
    }

    // Create verifier info
    const verifier: Verifier = {
      name: options.verifierName || 'Anonymous Verifier',
      publicKey: verifierPublicKey as HexString,
      did: options.verifierDid,
    };

    // Verify the attestation
    if (options.verbose) {
      console.log('Verifying attestation...');
      console.log(`  Attestation ID: ${attestation.metadata.attestationId}`);
      console.log(`  Issuer: ${attestation.metadata.issuer.name}`);
      console.log(`  Claims: ${attestation.claims.length}\n`);
    }

    const proofId = attestation.metadata.proofId;

    const verification = await verifyAttestation(attestation, {
      verifier,
      verifiedAt: new Date().toISOString(),
      signingKey: verifierPrivateKey as HexString,
      vlayerCredentials: options.vlayerClientId && options.vlayerAuthToken
        ? { clientId: options.vlayerClientId, authToken: options.vlayerAuthToken }
        : undefined,
    });

    // Write verification file
    if (options.verbose) {
      console.log('Writing verification...');
    }

    await writeFile(outputPath, JSON.stringify(verification, null, 2), 'utf-8');

    // Print summary
    console.log('\nVerification Summary:');
    console.log('='.repeat(50));
    console.log(`Total Claims:     ${verification.summary.totalClaims}`);
    console.log(`Valid Claims:     ${verification.summary.validClaims}`);
    console.log(`Invalid Claims:   ${verification.summary.invalidClaims}`);
    console.log(`Uncertain Claims: ${verification.summary.uncertainClaims}`);
    console.log(`Overall Status:   ${verification.summary.overallStatus}`);
    console.log('='.repeat(50));

    if (options.verbose) {
      console.log('\nClaim Details:');
      for (const outcome of verification.outcomes) {
        console.log(`  [${outcome.status}] ${outcome.claimId}`);
        if (outcome.error) {
          console.log(`    Error: ${outcome.error}`);
        }
        if ('notes' in outcome.evidence && outcome.evidence.notes) {
          console.log(`    Notes: ${outcome.evidence.notes}`);
        }
      }
    }

    console.log(`\nVerification saved to: ${outputPath}`);

    // Publish to IPFS and registry if requested
    if (options.publish) {
      console.log('\n='.repeat(50));
      console.log('Publishing verification...');
      console.log('='.repeat(50));

      if (!options.registry) throw new Error('--registry is required with --publish');
      if (!options.rpcUrl) throw new Error('--rpc-url is required with --publish');
      if (!options.privateKey) throw new Error('--private-key is required with --publish');
      if (!proofId) throw new Error('Attestation does not contain a proofId. Cannot publish to registry.');

      // Push to IPFS
      const ipfsUrl = options.ipfsUrl || 'https://save-ipfs.llamarisk.com';
      
      console.log('\nIPFS Configuration:');
      console.log(`  Endpoint: ${ipfsUrl}`);
      console.log(`  Username: ${options.ipfsUsername || '(not provided)'}`);
      console.log(`  Password: ${options.ipfsPassword ? '********' : '(not provided)'}`);
      console.log('');
      
      const verificationCid = await pushToIpfs(
        verification,
        ipfsUrl,
        options.ipfsUsername,
        options.ipfsPassword
      );

      console.log(`Verification uploaded to IPFS: ${verificationCid}`);

      const verificationHash = ipfsCidToHash(verificationCid);
      console.log(`Verification hash: ${verificationHash}`);

      // Fetch latest attestation hash from registry
      if (options.verbose) {
        console.log('\nFetching latest attestation hash from registry...');
      }

      const latestAttestation = await fetchLatestAttestation(
        options.registry,
        proofId,
        options.rpcUrl
      );

      console.log(`Latest attestation hash from registry: ${latestAttestation.attestationHash}`);
      console.log(`Attestor: ${latestAttestation.attestor}`);
      console.log(`Timestamp: ${latestAttestation.timestamp}`);

      // Add attestation hash to verification metadata
      verification.metadata.attestationHash = latestAttestation.attestationHash as HexString;

      // Re-write verification file with updated metadata
      await writeFile(outputPath, JSON.stringify(verification, null, 2), 'utf-8');

      // Push to registry
      if (options.verbose) {
        console.log('\nPushing verification to registry...');
      }

      await setVerification(
        options.registry,
        proofId,
        latestAttestation.attestationHash,
        verificationHash,
        options.rpcUrl,
        options.privateKey
      );

      console.log('\nVerification published successfully!');
      console.log(`  - IPFS CID: ${verificationCid}`);
      console.log(`  - Verification Hash: ${verificationHash}`);
      console.log(`  - Proof ID: ${proofId}`);
      console.log(`  - Attestation Hash: ${latestAttestation.attestationHash}`);
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : 'Unknown error');
    
    if (process.argv.includes('--verbose') || process.argv.includes('-v')) {
      console.error('\nStack trace:');
      console.error(error);
    }
    
    process.exit(1);
  }
}

// Run CLI only when executed directly (not imported for testing)
const isDirectExecution = process.argv[1]?.endsWith('verify.ts') || process.argv[1]?.endsWith('verify.js');
if (isDirectExecution) {
  main();
}
