/**
 * On-chain contract interaction for verification publishing
 */
/**
 * Call setVerification on the registry contract.
 * Note: ABI field names (proofId, proofIdToLatestAttestation) match the deployed
 * contract interface and must not be renamed.
 */
export async function setVerification(registryAddress, proofId, attestationHash, verificationHash, rpcUrl, privateKey) {
    // Use viem for contract interaction (lazy-loaded)
    const { createWalletClient, http, publicActions } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { sepolia } = await import('viem/chains');
    const account = privateKeyToAccount(privateKey);
    const client = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
    }).extend(publicActions);
    // ABI field names match the deployed contract (proofId is the on-chain name)
    const abi = [{
            name: 'setVerification',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
                { name: 'proofId', type: 'bytes32' },
                { name: 'expectedAttestationHash', type: 'bytes32' },
                { name: 'verificationHash', type: 'bytes32' },
            ],
            outputs: [],
        }];
    const hash = await client.writeContract({
        address: registryAddress,
        abi,
        functionName: 'setVerification',
        args: [proofId, attestationHash, verificationHash],
    });
    console.log(`Transaction hash: ${hash}`);
    // Wait for transaction confirmation
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
}
/**
 * Fetch the latest attestation info from the registry contract
 */
export async function fetchLatestAttestation(registryAddress, proofId, rpcUrl) {
    const { createPublicClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });
    // ABI field names match the deployed contract (proofId is the on-chain name)
    const [attestationHash, attestor, timestamp] = await publicClient.readContract({
        address: registryAddress,
        abi: [{
                name: 'proofIdToLatestAttestation',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'proofId', type: 'bytes32' }],
                outputs: [
                    { name: 'attestationHash', type: 'bytes32' },
                    { name: 'attestor', type: 'address' },
                    { name: 'timestamp', type: 'uint48' }
                ],
            }],
        functionName: 'proofIdToLatestAttestation',
        args: [proofId],
    });
    return {
        attestationHash: attestationHash,
        attestor: attestor,
        timestamp,
    };
}
//# sourceMappingURL=onchain.js.map