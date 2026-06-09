/**
 * Claim types for SAVE
 *
 * Claims are standardized assertions that can be:
 * 1. Inline: predefined structure (e.g., numeric claims) with data and proof
 * 2. Source-backed: pointer to data in an object claim that has a proof
 * 3. Aggregated: computed from other claims using aggregation functions
 *
 * The claim structure is canonical to ensure consistent signing/verification.
 */
import { sortObjectKeys } from '../utils/sort.js';
/** Type guard for numeric claim content */
export function isNumericClaimContent(claim) {
    return 'dataType' in claim && claim.dataType === 'numeric';
}
/** Type guard for string claim content */
export function isStringClaimContent(claim) {
    return 'dataType' in claim && claim.dataType === 'string';
}
/** Type guard for object claim content */
export function isObjectClaimContent(claim) {
    return 'dataType' in claim && claim.dataType === 'object';
}
/** Check if claim data is an inline claim (narrows to InlineClaimData) */
export function isInlineClaim(claim) {
    return claim.claimType === 'inline';
}
/** Check if claim data is a source-backed claim (narrows to SourceBackedClaimData) */
export function isSourceBackedClaim(claim) {
    return claim.claimType === 'source-backed';
}
/** Check if claim data is an aggregated claim (narrows to AggregatedClaimData) */
export function isAggregatedClaim(claim) {
    return claim.claimType === 'aggregation';
}
/** Type guard for NumericData */
export function isNumericData(data) {
    return typeof data === 'object' && data !== null && 'value' in data;
}
/** Type guard for StringData */
export function isStringData(data) {
    return typeof data === 'object' && data !== null && 'value' in data && typeof data.value === 'string';
}
/** Type guard for ClaimPointer */
export function isClaimPointer(data) {
    return typeof data === 'string';
}
/** Type guard for ObjectClaimData */
export function isObjectClaim(claim) {
    return claim.dataType === 'object';
}
/** Type guard for NumericClaimData */
export function isNumericClaim(claim) {
    return claim.dataType === 'numeric';
}
/** Type guard for StringClaimData */
export function isStringClaim(claim) {
    return claim.dataType === 'string';
}
/**
 * Create the canonical representation of a claim for signing.
 * This ensures all parties produce the same bytes when signing.
 * Uses discriminated union narrowing on dataType for type safety.
 */
export function canonicalizeClaimForSigning(claim) {
    const canonical = {
        id: claim.id,
        claimType: claim.claimType,
        dataType: claim.dataType,
    };
    if (claim.dataType === 'object') {
        // TODO: Add schemaId and schemaHash to canonical representation
        canonical.format = claim.format;
        canonical.data = claim.data;
    }
    else if (claim.dataType === 'numeric') {
        canonical.value = claim.value;
        canonical.unit = claim.unit;
        if (claim.asset !== undefined) {
            canonical.asset = {
                address: claim.asset.address,
                chainId: claim.asset.chainId,
            };
        }
    }
    else if (claim.dataType === 'string') {
        canonical.value = claim.value;
        if (claim.expectedValue !== undefined) {
            canonical.expectedValue = claim.expectedValue;
        }
    }
    if (claim.description !== undefined) {
        canonical.description = claim.description;
    }
    // Deep sort all object keys for deterministic canonicalization
    const sorted = sortObjectKeys(canonical);
    return JSON.stringify(sorted);
}
//# sourceMappingURL=claim.js.map