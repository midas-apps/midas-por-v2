/**
 * CLI argument parsing and environment file loading
 */

import { existsSync, readFileSync } from 'fs';

export interface CLIOptions {
  input: string;
  output?: string;
  verifierName?: string;
  verifierKey?: string;
  verifierDid?: string;
  verbose?: boolean;
  publish?: boolean;
  registry?: string;
  rpcUrl?: string;
  ipfsUrl?: string;
  ipfsUsername?: string;
  ipfsPassword?: string;
  privateKey?: string;
  envFile?: string;
  vlayerClientId?: string;
  vlayerAuthToken?: string;
}

/**
 * Load environment variables from a .env file
 */
export function loadEnvFile(filePath: string): Record<string, string> {
  if (filePath.includes('..') || require('path').isAbsolute(filePath)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  if (!existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`);
  }
  
  const content = readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Parse KEY=VALUE
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      env[key] = value;
    }
  }
  
  return env;
}

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    input: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (!arg.startsWith('-') && !options.input) {
      options.input = arg;
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--verifier-name' || arg === '-n') {
      options.verifierName = args[++i];
    } else if (arg === '--verifier-key' || arg === '-k') {
      options.verifierKey = args[++i];
    } else if (arg === '--verifier-did' || arg === '-d') {
      options.verifierDid = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--publish' || arg === '-p') {
      options.publish = true;
    } else if (arg === '--registry') {
      options.registry = args[++i];
    } else if (arg === '--rpc-url') {
      options.rpcUrl = args[++i];
    } else if (arg === '--ipfs-url') {
      options.ipfsUrl = args[++i];
    } else if (arg === '--ipfs-username') {
      options.ipfsUsername = args[++i];
    } else if (arg === '--ipfs-password') {
      options.ipfsPassword = args[++i];
    } else if (arg === '--private-key') {
      options.privateKey = args[++i];
    } else if (arg === '--env-file' || arg === '-e') {
      options.envFile = args[++i];
    } else if (arg === '--vlayer-client-id') {
      options.vlayerClientId = args[++i];
    } else if (arg === '--vlayer-auth-token') {
      options.vlayerAuthToken = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help message
 */
export function printHelp(): void {
  console.log(`
SAVE Attestation Verifier

Usage:
  save-verify <attestation.json> [options]

Options:
  -o, --output <file>           Output file for verification (default: verification.json)
  -n, --verifier-name <name>    Name of the verifier (default: "Anonymous Verifier")
  -k, --verifier-key <key>      Verifier's private key in hex (generates new if not provided)
  -d, --verifier-did <did>      Verifier's DID identifier
  -v, --verbose                 Show detailed verification output
  -p, --publish                 Publish verification to IPFS and on-chain registry
  --registry <address>          Registry contract address (required with --publish)
  --rpc-url <url>               RPC URL for blockchain connection (required with --publish)
  --ipfs-url <url>              IPFS API URL (default: https://save-ipfs.llamarisk.com)
  --ipfs-username <user>        IPFS username for authentication
  --ipfs-password <pass>        IPFS password for authentication
  --private-key <key>           Private key for signing on-chain transaction (required with --publish)
  --vlayer-client-id <id>       Vlayer client ID for ZK-TLS proof verification
  --vlayer-auth-token <token>   Vlayer auth token for ZK-TLS proof verification
  -e, --env-file <file>         Load credentials from .env file (recommended for special chars in passwords)
  -h, --help                    Show this help message

Examples:
  save-verify attestation.json
  save-verify attestation.json -o my-verification.json
  save-verify attestation.json -n "TrustedVerifier Inc" -k 0x123...
  save-verify attestation.json --publish --env-file .env
  save-verify attestation.json --publish --registry 0x123... --rpc-url https://... --private-key 0x...

For more information, visit: https://github.com/llamarisk/save
  `);
}
