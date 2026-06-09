/**
 * On-chain contract interaction for verification publishing
 */
/**
 * Call setVerification on the registry contract.
 * Note: ABI field names (proofId, proofIdToLatestAttestation) match the deployed
 * contract interface and must not be renamed.
 */
export declare function setVerification(registryAddress: string, proofId: string, attestationHash: string, verificationHash: string, rpcUrl: string, privateKey: string): Promise<void>;
/**
 * Fetch the latest attestation info from the registry contract
 */
export declare function fetchLatestAttestation(registryAddress: string, proofId: string, rpcUrl: string): Promise<{
    attestationHash: string;
    attestor: string;
    timestamp: unknown;
}>;
//# sourceMappingURL=onchain.d.ts.map