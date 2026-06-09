/**
 * CLI argument parsing and environment file loading
 */
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
export declare function loadEnvFile(filePath: string): Record<string, string>;
/**
 * Parse command line arguments
 */
export declare function parseArgs(args: string[]): CLIOptions;
/**
 * Print help message
 */
export declare function printHelp(): void;
//# sourceMappingURL=args.d.ts.map