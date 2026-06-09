/**
 * Claim pointer parsing utility
 *
 * Extracted to deduplicate pointer parsing logic shared by:
 * - verification/verifier.ts (source-backed claim verification)
 * - dag/claim-dag.ts (pointer resolution)
 */
/** Parsed result from a claim pointer string */
export interface ParsedPointer {
    /** The source claim ID (before the #) */
    sourceClaimId: string;
    /** The path portion (after the #) */
    path: string;
}
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
export declare function parseClaimPointer(pointer: string): ParsedPointer;
//# sourceMappingURL=pointer.d.ts.map