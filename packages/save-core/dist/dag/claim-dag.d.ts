/**
 * ClaimDAG - Directed Acyclic Graph for claims
 *
 * Manages the dependency graph between claims and handles
 * topological resolution of composite claims.
 */
import type { ClaimId, ClaimData } from '../types/index.js';
import { NumericClaim } from '../claims/numeric.js';
import { ObjectClaim } from '../claims/object.js';
import { StringClaim } from '../claims/string.js';
/** Union type for all concrete claim types */
type Claim = NumericClaim | ObjectClaim | StringClaim;
/**
 * ClaimDAG manages a directed acyclic graph of claims.
 *
 * Features:
 * - Detects cycles during claim addition
 * - Resolves composite claims in topological order
 * - Validates all dependencies are satisfied
 */
export declare class ClaimDAG {
    private readonly claims;
    private readonly dependents;
    private readonly values;
    /**
     * Add a claim to the DAG and immediately resolve it
     * @param claim - The claim to add
     * @throws If claim ID already exists, would create a cycle, or dependencies are not satisfied
     */
    addClaim(claim: Claim): this;
    /**
     * Get a claim by ID
     */
    getClaim(id: ClaimId): Claim | undefined;
    /**
     * Get all claims in the DAG
     */
    getAllClaims(): Claim[];
    /**
     * Get leaf (primitive) claims
     */
    getLeafClaims(): Claim[];
    /**
     * Get composite claims
     */
    getCompositeClaims(): Claim[];
    /**
     * Check if a claim has all its dependencies satisfied
     */
    hasDependenciesSatisfied(id: ClaimId): boolean;
    /**
     * Resolve a single claim (source-backed or aggregation)
     * @param claim - The claim to resolve
     * @private
     */
    private resolveClaim;
    /**
     * Resolve a pointer string to numeric data from an object claim
     * @param pointer - Pointer string in format:
     *   - JSON: "claimId#/json/pointer/path"
     *   - Structured text: "claimId#line:N", "claimId#char:START-END", "claimId#lines:START-END"
     *   - Combined: "claimId#/json/path#line:N"
     * @param objectClaimMap - Map of object claim IDs to ObjectClaim instances
     * @returns The resolved NumericData
     */
    private resolvePointer;
    /**
     * Convert a resolved value to NumericData
     * Handles:
     * - Plain numbers: converts to NumericData with the claim's default unit
     * - Numeric strings: parses and converts to NumericData
     * - NumericData objects: returns as-is
     *
     * @param value - The resolved value
     * @param pointer - Full pointer string for error messages
     * @param defaultUnit - Unit to use when the resolved value is a plain number/string.
     *   If not provided and the value has no unit, throws an error.
     * @returns NumericData
     */
    private convertToNumericData;
    /**
     * Resolve a pointer string to a string value from an object claim
     * @param pointer - Pointer string in format "claimId#/json/pointer/path"
     * @param objectClaimMap - Map of object claim IDs to ObjectClaim instances
     * @returns The resolved string value
     */
    private resolveStringPointer;
    /**
     * Export all claims to data format
     * All claims are resolved incrementally as they are added.
     */
    toClaimData(): ClaimData[];
    /**
     * Check if adding the given claim creates a cycle
     * Uses DFS to detect back edges
     */
    private hasCycle;
}
export {};
//# sourceMappingURL=claim-dag.d.ts.map