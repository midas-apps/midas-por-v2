/**
 * Claim pointer parsing utility
 *
 * Extracted to deduplicate pointer parsing logic shared by:
 * - verification/verifier.ts (source-backed claim verification)
 * - dag/claim-dag.ts (pointer resolution)
 */
/**
 * Parse a claim pointer string into its component parts.
 *
 * Pointer format: "claimId#/json/pointer/path"
 * Splits on the first '#' only to support combined pointers
 * like "claimId#/field#line:5".
 *
 * @param pointer - The full pointer string
 * @returns Parsed pointer with sourceClaimId and path
 * @throws Error if the pointer format is invalid
 */
export function parseClaimPointer(pointer) {
    const hashIndex = pointer.indexOf('#');
    if (hashIndex === -1) {
        throw new Error(`Invalid pointer format: "${pointer}". Expected "claimId#path"`);
    }
    const sourceClaimId = pointer.substring(0, hashIndex);
    const path = pointer.substring(hashIndex + 1);
    if (!sourceClaimId || !path) {
        throw new Error(`Invalid pointer format: "${pointer}". Expected "claimId#path"`);
    }
    return { sourceClaimId, path };
}
//# sourceMappingURL=pointer.js.map