/**
 * Attestation Verifier
 *
 * Verifies SAVE attestations by checking:
 * - Attestation signature validity
 * - Individual claim proofs
 * - Aggregation correctness
 * - Source-backed claim resolution
 */
import { sign } from '../crypto/ecdsa.js';
import { checkAttestationVersion } from '../version.js';
const NUMERIC_EPSILON = 1e-9;
import { verify, hashObject, deterministicId } from '../crypto/ecdsa.js';
import { parseClaimPointer } from '../utils/pointer.js';
import { isNumericClaim, isObjectClaim, isStringClaim, isInlineClaim, isSourceBackedClaim, isAggregatedClaim, canonicalizeClaimForSigning } from '../types/claim.js';
import { executeNumericAggregation } from '../aggregation/numeric.js';
import { getReferencedClaimIds } from '../types/aggregation.js';
import { verifyZkTlsNotaryProof } from '../proofs/tls-notary.js';
import { resolveObjectPointer } from '../claims/structured-text.js';
/**
 * Verify a complete attestation and generate a verification document
 */
export async function verifyAttestation(attestation, options) {
    const outcomes = [];
    // Step 0: Check schema version compatibility
    checkSchemaCompatibility(attestation);
    // Step 1: Verify the attestation signature
    const attestationSignatureValid = verifyAttestationSignature(attestation);
    if (!attestationSignatureValid) {
        throw new Error('Attestation signature is invalid');
    }
    // Step 1.5: Check attestation expiration (opt-out via checkExpiration: false)
    if (options.checkExpiration !== false && attestation.metadata.expiresAt) {
        const expiresAt = new Date(attestation.metadata.expiresAt);
        if (expiresAt.getTime() < Date.now()) {
            throw new Error(`Attestation expired at ${attestation.metadata.expiresAt}. ` +
                `Pass checkExpiration: false to verify expired attestations for historical purposes.`);
        }
    }
    // Step 2: Build a map of claims for reference resolution
    const claimMap = new Map();
    for (const claimData of attestation.claims) {
        claimMap.set(claimData.id, claimData);
    }
    // Step 3: Verify each claim independently
    for (const claimData of attestation.claims) {
        const outcome = await verifyClaim(claimData, claimMap, options);
        outcomes.push(outcome);
    }
    // Step 4: Propagate failures from dependencies
    const outcomeMap = new Map();
    for (const outcome of outcomes) {
        outcomeMap.set(outcome.claimId, outcome);
    }
    propagateDependencyFailures(attestation.claims, outcomeMap);
    // Step 5: Calculate summary
    const summary = calculateSummary(outcomes);
    // Step 6: Extract errors from failed/uncertain claims
    const errors = outcomes
        .filter(outcome => outcome.status === 'Invalid' || outcome.status === 'Uncertain')
        .map(outcome => ({
        claimId: outcome.claimId,
        status: outcome.status,
        error: outcome.error,
        evidence: outcome.evidence,
    }));
    // Step 7: Generate verification metadata
    const verificationId = deterministicId(options.verifiedAt + attestation.metadata.attestationId);
    const metadata = {
        verifier: options.verifier,
        verifiedAt: options.verifiedAt,
        attestationId: attestation.metadata.attestationId,
        verificationId,
        ...(attestation.metadata.proofId && { proofId: attestation.metadata.proofId }),
    };
    // Step 8: Sign the verification (sign all fields except signature itself)
    const signature = signVerification({ metadata, outcomes, summary, errors }, options.signingKey, options.verifier.publicKey);
    return {
        metadata,
        outcomes,
        summary,
        signature,
        errors,
    };
}
/**
 * Check that the attestation's schema version is compatible with this library.
 */
function checkSchemaCompatibility(attestation) {
    checkAttestationVersion(attestation.metadata.schema, attestation.metadata.version);
}
/**
 * Verify the attestation's overall signature
 */
function verifyAttestationSignature(attestation) {
    try {
        const signedDataHash = hashObject({
            metadata: attestation.metadata,
            claims: attestation.claims,
        });
        // Verify the signature matches
        if (attestation.signature.signedData !== signedDataHash) {
            return false;
        }
        return verify(signedDataHash, attestation.signature.signature, attestation.signature.publicKey);
    }
    catch (error) {
        return false;
    }
}
/**
 * Verify an individual claim.
 * Dispatches to the appropriate verifier based on dataType and claimType.
 */
async function verifyClaim(claimData, claimMap, options) {
    try {
        if (isObjectClaim(claimData)) {
            return await verifyObjectClaim(claimData, options);
        }
        if (isNumericClaim(claimData)) {
            if (isInlineClaim(claimData)) {
                return await verifyInlineNumericClaim(claimData, options);
            }
            if (isSourceBackedClaim(claimData)) {
                return verifySourceBackedNumericClaim(claimData, claimMap);
            }
            if (isAggregatedClaim(claimData)) {
                return verifyAggregatedNumericClaim(claimData, claimMap);
            }
        }
        if (isStringClaim(claimData)) {
            if (isInlineClaim(claimData)) {
                return await verifyInlineStringClaim(claimData, options);
            }
            if (isSourceBackedClaim(claimData)) {
                return verifySourceBackedStringClaim(claimData, claimMap);
            }
        }
        // All dataType/claimType combinations are covered above; this is a safety net.
        const unknown = claimData;
        throw new Error(`Unknown claim type: ${unknown.dataType}/${unknown.claimType}`);
    }
    catch (error) {
        const cd = claimData;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        // Create appropriate evidence based on claim type
        let evidence;
        if (cd.claimType === 'aggregation') {
            evidence = {
                aggregationVerified: false,
                computedValue: 0,
                notes: `Verification failed: ${errorMsg}`,
            };
        }
        else if (cd.claimType === 'source-backed') {
            evidence = {
                pointer: '',
                resolvedValue: cd.dataType === 'numeric' ? 0 : '',
                notes: `Verification failed: ${errorMsg}`,
            };
        }
        else {
            // inline
            evidence = {
                proof: { trustModel: 'unknown', mechanism: 'unknown' },
                value: cd.dataType === 'numeric' ? 0 : (cd.dataType === 'string' ? '' : {}),
                notes: `Verification failed: ${errorMsg}`,
            };
        }
        return {
            claimId: cd.id || 'unknown',
            claimType: cd.claimType || 'inline',
            dataType: cd.dataType || 'object',
            status: 'Invalid',
            evidence,
            error: errorMsg,
        };
    }
}
/**
 * Verify an object claim
 */
async function verifyObjectClaim(claimData, options) {
    if (!claimData.proof) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                proof: { trustModel: 'unknown', mechanism: 'unknown' },
                value: claimData.data,
                notes: 'Object claim missing proof',
            },
            error: 'Object claim must have a proof',
        };
    }
    // Verify the proof
    const proofResult = await verifyProof(claimData, claimData.proof, options);
    return {
        claimId: claimData.id,
        claimType: claimData.claimType,
        dataType: claimData.dataType,
        status: proofResult.success ? 'Valid' : 'Invalid',
        evidence: {
            proof: {
                trustModel: claimData.proof.trustModel,
                mechanism: claimData.proof.mechanism,
            },
            value: claimData.data,
            notes: proofResult.success
                ? `Object claim proof verified (${claimData.proof.trustModel}/${claimData.proof.mechanism}).`
                : `Proof verification failed: ${proofResult.error || 'Unknown reason'}`,
        },
        error: proofResult.success ? undefined : proofResult.error,
    };
}
/**
 * Verify an inline numeric claim
 */
async function verifyInlineNumericClaim(claimData, options) {
    const proofResult = await verifyProof(claimData, claimData.proof, options);
    return {
        claimId: claimData.id,
        claimType: claimData.claimType,
        dataType: claimData.dataType,
        status: proofResult.success ? 'Valid' : 'Invalid',
        evidence: {
            proof: {
                trustModel: claimData.proof.trustModel,
                mechanism: claimData.proof.mechanism,
            },
            value: claimData.data.value,
            notes: proofResult.success
                ? `Proof verified (${claimData.proof.trustModel}/${claimData.proof.mechanism}).`
                : `Proof verification failed: ${proofResult.error || 'Unknown reason'}`,
        },
        error: proofResult.success ? undefined : proofResult.error,
    };
}
/**
 * Verify a source-backed numeric claim
 */
function verifySourceBackedNumericClaim(claimData, claimMap) {
    // Parse pointer using shared utility
    let parsed;
    try {
        parsed = parseClaimPointer(claimData.pointer);
    }
    catch {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: 0,
                notes: 'Invalid pointer format',
            },
            error: 'Pointer must be in format "claimId#/path"',
        };
    }
    const { sourceClaimId, path: jsonPath } = parsed;
    // Get the source claim
    const sourceClaimData = claimMap.get(sourceClaimId);
    if (!sourceClaimData || !isObjectClaim(sourceClaimData)) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: 0,
                notes: 'Source claim not found or not an object claim',
            },
            error: `Source claim ${sourceClaimId} not found`,
        };
    }
    // Resolve the pointer
    try {
        let resolvedValue = resolvePointer(sourceClaimData.data, jsonPath);
        // Handle NumericData objects ({ value, unit })
        if (typeof resolvedValue === 'object' && resolvedValue !== null) {
            const obj = resolvedValue;
            if (typeof obj.value === 'number') {
                resolvedValue = obj.value;
            }
            else {
                throw new Error(`Resolved object does not contain a numeric 'value' field`);
            }
        }
        // Convert strings to numbers if needed (e.g., "83235987")
        if (typeof resolvedValue === 'string') {
            const cleaned = resolvedValue.trim().replace(/,/g, '');
            const parsed = parseFloat(cleaned);
            if (isNaN(parsed)) {
                throw new Error(`Cannot parse resolved string "${resolvedValue}" as a number`);
            }
            resolvedValue = parsed;
        }
        if (typeof resolvedValue !== 'number') {
            throw new Error(`Resolved value is not a number: ${typeof resolvedValue}`);
        }
        // Cross-check against stored resolvedValue (strict equality — both come from the same pointer resolution)
        if (claimData.resolvedValue !== undefined && resolvedValue !== claimData.resolvedValue) {
            return {
                claimId: claimData.id,
                claimType: claimData.claimType,
                dataType: claimData.dataType,
                status: 'Invalid',
                evidence: {
                    pointer: claimData.pointer,
                    resolvedValue: resolvedValue,
                    expectedValue: claimData.resolvedValue,
                    notes: `Resolved value mismatch: computed ${resolvedValue}, claimed ${claimData.resolvedValue}`,
                },
                error: 'Resolved value does not match stored resolvedValue',
            };
        }
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Valid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: resolvedValue,
                notes: `Resolved from object claim '${sourceClaimId}'; source proof verification inherited (${sourceClaimData.proof.mechanism}).`,
            },
        };
    }
    catch (error) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: 0,
                notes: 'Failed to resolve pointer',
            },
            error: error instanceof Error ? error.message : 'Pointer resolution failed',
        };
    }
}
/**
 * Verify an aggregated numeric claim
 */
function verifyAggregatedNumericClaim(claimData, claimMap) {
    if (claimData.resolvedValue === undefined) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                aggregationVerified: false,
                computedValue: 0,
                notes: 'Aggregated claim has no resolved value (DAG resolution may have failed)',
            },
            error: 'Missing resolved value',
        };
    }
    try {
        const referencedIds = getReferencedClaimIds(claimData.aggregation);
        // Resolve values from claim map
        const values = new Map();
        for (const id of referencedIds) {
            const referencedClaim = claimMap.get(id);
            if (!referencedClaim) {
                throw new Error(`Referenced claim ${id} not found`);
            }
            let value;
            if (isNumericClaim(referencedClaim)) {
                if (isInlineClaim(referencedClaim)) {
                    value = referencedClaim.data.value;
                }
                else if (referencedClaim.resolvedValue !== undefined) {
                    value = referencedClaim.resolvedValue;
                }
            }
            else if (isObjectClaim(referencedClaim)) {
                throw new Error(`Cannot aggregate object claim ${id}`);
            }
            if (value === undefined) {
                throw new Error(`Referenced claim ${id} has no numeric value`);
            }
            values.set(id, value);
        }
        const computedValue = executeNumericAggregation(claimData.aggregation, values);
        const matches = Math.abs(computedValue - claimData.resolvedValue) < NUMERIC_EPSILON;
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: matches ? 'Valid' : 'Invalid',
            evidence: {
                aggregationVerified: matches,
                computedValue: computedValue,
                expectedValue: claimData.resolvedValue,
                notes: matches
                    ? `Verified aggregation: ${formatAggregation(claimData.aggregation)}`
                    : `Aggregation mismatch: computed ${computedValue}, claimed ${claimData.resolvedValue}`,
            },
            error: matches ? undefined : 'Aggregation value mismatch',
        };
    }
    catch (error) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                aggregationVerified: false,
                computedValue: 0,
                notes: 'Aggregation verification failed',
            },
            error: error instanceof Error ? error.message : 'Aggregation failed',
        };
    }
}
/**
 * Verify an inline string claim
 */
async function verifyInlineStringClaim(claimData, options) {
    const proofResult = await verifyProof(claimData, claimData.proof, options);
    // Verify equality constraint if present
    let equalityNotes = '';
    let equalityMatches = true;
    if (claimData.expectedValue !== undefined) {
        equalityMatches = claimData.data.value === claimData.expectedValue;
        equalityNotes = equalityMatches
            ? ` Equality verified: "${claimData.expectedValue}"`
            : ` Equality mismatch: expected "${claimData.expectedValue}", got "${claimData.data.value}"`;
    }
    return {
        claimId: claimData.id,
        claimType: claimData.claimType,
        dataType: claimData.dataType,
        status: proofResult.success && equalityMatches ? 'Valid' : 'Invalid',
        evidence: {
            proof: {
                trustModel: claimData.proof.trustModel,
                mechanism: claimData.proof.mechanism,
            },
            value: claimData.data.value,
            notes: proofResult.success
                ? `Proof verified (${claimData.proof.trustModel}/${claimData.proof.mechanism}).${equalityNotes}`
                : `Proof verification failed: ${proofResult.error || 'Unknown reason'}`,
        },
        error: proofResult.success && equalityMatches ? undefined : (equalityMatches ? proofResult.error : 'Equality constraint not satisfied'),
    };
}
/**
 * Verify a source-backed string claim
 */
function verifySourceBackedStringClaim(claimData, claimMap) {
    // Parse pointer using shared utility
    let parsed;
    try {
        parsed = parseClaimPointer(claimData.pointer);
    }
    catch {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: '',
                notes: 'Invalid pointer format',
            },
            error: 'Pointer must be in format "claimId#/path"',
        };
    }
    const { sourceClaimId, path: jsonPath } = parsed;
    // Get the source claim
    const sourceClaimData = claimMap.get(sourceClaimId);
    if (!sourceClaimData || !isObjectClaim(sourceClaimData)) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: '',
                notes: 'Source claim not found or not an object claim',
            },
            error: `Source claim ${sourceClaimId} not found`,
        };
    }
    // Resolve the pointer
    try {
        let resolvedValue = resolvePointer(sourceClaimData.data, jsonPath);
        if (typeof resolvedValue !== 'string') {
            resolvedValue = String(resolvedValue);
        }
        // Cross-check against stored resolvedValue if present
        if (claimData.resolvedValue !== undefined && resolvedValue !== claimData.resolvedValue) {
            return {
                claimId: claimData.id,
                claimType: claimData.claimType,
                dataType: claimData.dataType,
                status: 'Invalid',
                evidence: {
                    pointer: claimData.pointer,
                    resolvedValue: resolvedValue,
                    expectedValue: claimData.resolvedValue,
                    notes: `Resolved value mismatch: computed "${resolvedValue}", claimed "${claimData.resolvedValue}"`,
                },
                error: 'Resolved value does not match stored resolvedValue',
            };
        }
        // Verify equality constraint if present
        let equalityNotes = '';
        let equalityMatches = true;
        if (claimData.expectedValue !== undefined) {
            equalityMatches = resolvedValue === claimData.expectedValue;
            equalityNotes = equalityMatches
                ? ` Equality verified: "${claimData.expectedValue}"`
                : ` Equality mismatch: expected "${claimData.expectedValue}", got "${resolvedValue}"`;
        }
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: equalityMatches ? 'Valid' : 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: resolvedValue,
                expectedValue: claimData.expectedValue,
                notes: `Resolved from object claim '${sourceClaimId}': "${resolvedValue}"${equalityNotes}`,
            },
            error: equalityMatches ? undefined : 'Equality constraint not satisfied',
        };
    }
    catch (error) {
        return {
            claimId: claimData.id,
            claimType: claimData.claimType,
            dataType: claimData.dataType,
            status: 'Invalid',
            evidence: {
                pointer: claimData.pointer,
                resolvedValue: '',
                notes: 'Failed to resolve pointer',
            },
            error: error instanceof Error ? error.message : 'Pointer resolution failed',
        };
    }
}
/**
 * Propagate verification failures from dependencies
 *
 * Rules:
 * - Source-backed claims inherit failure from their source object claims
 * - Aggregated claims inherit failure from any failed sub-claims
 */
function propagateDependencyFailures(claims, outcomeMap) {
    for (const claimData of claims) {
        const outcome = outcomeMap.get(claimData.id);
        if (!outcome)
            continue;
        // Skip if already invalid
        if (outcome.status === 'Invalid')
            continue;
        // Check source-backed claims
        if ((isNumericClaim(claimData) || isStringClaim(claimData)) && isSourceBackedClaim(claimData)) {
            const { sourceClaimId } = parseClaimPointer(claimData.pointer);
            if (sourceClaimId) {
                const sourceOutcome = outcomeMap.get(sourceClaimId);
                if (sourceOutcome && sourceOutcome.status === 'Invalid') {
                    // Propagate failure from source claim
                    outcome.status = 'Invalid';
                    outcome.error = `Source claim '${sourceClaimId}' verification failed`;
                    if ('notes' in outcome.evidence) {
                        outcome.evidence.notes = `Source claim verification failed: ${sourceOutcome.error || 'unknown error'}`;
                    }
                }
            }
        }
        // Check aggregated claims
        if (isNumericClaim(claimData) && isAggregatedClaim(claimData)) {
            const referencedIds = getReferencedClaimIds(claimData.aggregation);
            for (const depId of referencedIds) {
                const depOutcome = outcomeMap.get(depId);
                if (depOutcome && depOutcome.status === 'Invalid') {
                    // Propagate failure from dependency
                    outcome.status = 'Invalid';
                    outcome.error = `Dependency '${depId}' verification failed`;
                    if ('notes' in outcome.evidence) {
                        outcome.evidence.notes = `Dependency verification failed: ${depOutcome.error || 'unknown error'}`;
                    }
                    break; // One failed dependency is enough
                }
            }
        }
    }
}
/**
 * Module-level proof verifier registry (singleton).
 * Shared across all imports of this module.
 */
const proofVerifierRegistry = new Map();
/**
 * Register a proof verifier for a given mechanism name.
 *
 * @param mechanism - The proof mechanism name (e.g., 'signature', 'zk_tls_notary', 'custom_zkp')
 * @param handler - Async function that verifies the proof
 *
 * @example
 * ```typescript
 * registerProofVerifier('custom_zkp', async (proof, claimData, options) => {
 *   // Custom verification logic
 *   return { success: true };
 * });
 * ```
 */
export function registerProofVerifier(mechanism, handler) {
    proofVerifierRegistry.set(mechanism, handler);
}
// --- Built-in proof verifiers ---
registerProofVerifier('signature', async (proof, claimData, _options) => {
    const sigProof = proof;
    const claimContent = extractClaimContent(claimData);
    const canonicalData = canonicalizeClaimForSigning(claimContent);
    const isValid = verify(canonicalData, sigProof.signature, sigProof.signerPublicKey);
    return { success: isValid, error: isValid ? undefined : 'Signature verification failed' };
});
registerProofVerifier('zk_tls_notary', async (proof, claimData, options) => {
    if (!options?.vlayerCredentials) {
        return { success: false, error: 'Vlayer credentials required to verify ZK-TLS Notary proofs' };
    }
    const tlsProof = proof;
    // Only inline claims with data can be verified against the notary
    const data = isInlineClaim(claimData) && 'data' in claimData ? claimData.data : undefined;
    const result = await verifyZkTlsNotaryProof(tlsProof, data, {
        clientId: options.vlayerCredentials.clientId,
        authToken: options.vlayerCredentials.authToken,
        httpClient: options.httpClient,
    });
    return { success: result.success, error: result.success ? undefined : (result.error || 'Unknown verification error') };
});
registerProofVerifier('cre_consensus', async () => {
    // CRE Consensus proofs are trusted: verified through Chainlink DON consensus
    return { success: true };
});
/**
 * Verify a proof using the registered proof verifier for its mechanism.
 */
async function verifyProof(claimData, proof, options) {
    try {
        const handler = proofVerifierRegistry.get(proof.mechanism);
        if (!handler) {
            return { success: false, error: `Proof mechanism '${proof.mechanism}' is not supported. Register a verifier with registerProofVerifier().` };
        }
        return await handler(proof, claimData, options);
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during proof verification',
        };
    }
}
/**
 * Extract claim content (without proof) for signature verification.
 * Returns a ClaimContent matching the shape used by canonicalizeClaimForSigning.
 */
function extractClaimContent(claimData) {
    if (isObjectClaim(claimData)) {
        return {
            id: claimData.id,
            claimType: 'inline',
            dataType: 'object',
            format: claimData.format,
            data: claimData.data,
            description: claimData.description,
        };
    }
    if (isNumericClaim(claimData) && isInlineClaim(claimData)) {
        return {
            id: claimData.id,
            claimType: 'inline',
            dataType: 'numeric',
            value: claimData.data.value,
            unit: claimData.data.unit,
            ...(claimData.data.asset !== undefined && { asset: claimData.data.asset }),
            ...(claimData.description !== undefined && { description: claimData.description }),
        };
    }
    if (isStringClaim(claimData) && isInlineClaim(claimData)) {
        return {
            id: claimData.id,
            claimType: 'inline',
            dataType: 'string',
            value: claimData.data.value,
            ...(claimData.expectedValue !== undefined && { expectedValue: claimData.expectedValue }),
            ...(claimData.description !== undefined && { description: claimData.description }),
        };
    }
    throw new Error(`Cannot extract signable content from non-inline claim: ${claimData.id}`);
}
/**
 * Resolve a pointer in object claim data (JSON, StructuredText, or combined)
 * Supports formats:
 * - JSON path: "/field/subfield"
 * - StructuredText: "line:5", "char:10-20", "lines:1-3"
 * - Combined: "/field#line:5"
 */
function resolvePointer(data, pointer) {
    return resolveObjectPointer(data, pointer);
}
/**
 * Format an aggregation for display
 */
function formatAggregation(agg) {
    const formatOperand = (op) => {
        if (typeof op === 'string') {
            return op;
        }
        return formatAggregation(op);
    };
    return `${agg.function}(${agg.operands.map(formatOperand).join(', ')})`;
}
/**
 * Calculate verification summary
 */
function calculateSummary(outcomes) {
    const validClaims = outcomes.filter(o => o.status === 'Valid').length;
    const invalidClaims = outcomes.filter(o => o.status === 'Invalid').length;
    const uncertainClaims = outcomes.filter(o => o.status === 'Uncertain').length;
    const overallStatus = invalidClaims > 0 ? 'Invalid' :
        uncertainClaims > 0 ? 'Uncertain' :
            'Valid';
    return {
        totalClaims: outcomes.length,
        validClaims: validClaims,
        invalidClaims: invalidClaims,
        uncertainClaims: uncertainClaims,
        overallStatus: overallStatus,
    };
}
/**
 * Sign the verification document
 * Signs all verification data except the signature field itself
 */
function signVerification(verificationData, signingKey, publicKey) {
    // Hash all the verification data (everything except signature)
    const dataHash = hashObject(verificationData);
    try {
        const signature = sign(dataHash, signingKey);
        return {
            algorithm: 'ECDSA_secp256k1',
            publicKey: publicKey,
            signature,
            signedData: dataHash,
        };
    }
    catch (error) {
        throw new Error(`Failed to sign verification: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
//# sourceMappingURL=verifier.js.map