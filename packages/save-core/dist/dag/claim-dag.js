/**
 * ClaimDAG - Directed Acyclic Graph for claims
 *
 * Manages the dependency graph between claims and handles
 * topological resolution of composite claims.
 */
import { NumericClaim } from '../claims/numeric.js';
import { ObjectClaim } from '../claims/object.js';
import { StringClaim } from '../claims/string.js';
import { executeNumericAggregation } from '../aggregation/numeric.js';
import { isClaimPointer } from '../types/claim.js';
import { resolveObjectPointer } from '../claims/structured-text.js';
import { parseClaimPointer } from '../utils/pointer.js';
/**
 * ClaimDAG manages a directed acyclic graph of claims.
 *
 * Features:
 * - Detects cycles during claim addition
 * - Resolves composite claims in topological order
 * - Validates all dependencies are satisfied
 */
export class ClaimDAG {
    claims = new Map();
    dependents = new Map();
    values = new Map(); // Store resolved numeric values for aggregations
    /**
     * Add a claim to the DAG and immediately resolve it
     * @param claim - The claim to add
     * @throws If claim ID already exists, would create a cycle, or dependencies are not satisfied
     */
    addClaim(claim) {
        if (this.claims.has(claim.id)) {
            throw new Error(`Claim with ID ${claim.id} already exists`);
        }
        // Validate dependencies exist (for both source-backed and aggregation claims)
        if (claim.dependencies.length > 0) {
            for (const depId of claim.dependencies) {
                if (!this.claims.has(depId)) {
                    throw new Error(`Claim ${claim.id} depends on ${depId} which has not been added yet. ` +
                        `Add dependencies before dependent claims.`);
                }
                // Validate dependencies are resolved
                const dep = this.claims.get(depId);
                if (claim.isComposite && !dep.isResolved && dep.isComposite) {
                    throw new Error(`Claim ${claim.id} depends on ${depId} which is not yet resolved. ` +
                        `This should not happen with incremental resolution.`);
                }
            }
        }
        // For composite claims, check for cycles
        if (claim.isComposite) {
            // Temporarily add the claim to check for cycles
            this.claims.set(claim.id, claim);
            if (this.hasCycle(claim.id)) {
                this.claims.delete(claim.id);
                throw new Error(`Adding claim ${claim.id} would create a cycle`);
            }
            // Register as dependent of sub-claims
            for (const depId of claim.dependencies) {
                if (!this.dependents.has(depId)) {
                    this.dependents.set(depId, new Set());
                }
                this.dependents.get(depId).add(claim.id);
            }
            // Resolve the composite claim immediately
            this.resolveClaim(claim);
        }
        else {
            // For primitive claims, add them
            this.claims.set(claim.id, claim);
            // If it's an inline numeric claim with a value, store it for aggregations
            if (claim.isInline && claim instanceof NumericClaim && claim.value !== undefined) {
                this.values.set(claim.id, claim.value);
            }
            // If it's a source-backed claim, resolve it immediately
            if (claim.isSourceBacked) {
                this.resolveClaim(claim);
            }
        }
        return this;
    }
    /**
     * Get a claim by ID
     */
    getClaim(id) {
        return this.claims.get(id);
    }
    /**
     * Get all claims in the DAG
     */
    getAllClaims() {
        return Array.from(this.claims.values());
    }
    /**
     * Get leaf (primitive) claims
     */
    getLeafClaims() {
        return this.getAllClaims().filter(c => c.isPrimitive);
    }
    /**
     * Get composite claims
     */
    getCompositeClaims() {
        return this.getAllClaims().filter(c => c.isComposite);
    }
    /**
     * Check if a claim has all its dependencies satisfied
     */
    hasDependenciesSatisfied(id) {
        const claim = this.claims.get(id);
        if (!claim)
            return false;
        if (claim.isPrimitive)
            return true;
        return claim.dependencies.every(depId => {
            const dep = this.claims.get(depId);
            return dep !== undefined && dep.isResolved;
        });
    }
    /**
     * Resolve a single claim (source-backed or aggregation)
     * @param claim - The claim to resolve
     * @private
     */
    resolveClaim(claim) {
        if (claim.isInline) {
            return; // Nothing to resolve for inline claims
        }
        // Build object claim map (needed for pointer resolution)
        const objectClaimMap = new Map();
        for (const c of this.claims.values()) {
            if (c instanceof ObjectClaim) {
                objectClaimMap.set(c.id, c);
            }
        }
        // Resolve source-backed claims
        if (claim.isSourceBacked) {
            if (claim instanceof NumericClaim) {
                const pointer = claim.data;
                if (isClaimPointer(pointer)) {
                    const resolvedData = this.resolvePointer(pointer, objectClaimMap, claim.unit);
                    claim._resolveFromDataSource(resolvedData);
                    this.values.set(claim.id, resolvedData.value);
                }
                else {
                    throw new Error(`Claim ${claim.id} is marked as source-backed but data is not a pointer`);
                }
            }
            else if (claim instanceof StringClaim) {
                const pointer = claim.data;
                if (isClaimPointer(pointer)) {
                    const resolvedValue = this.resolveStringPointer(pointer, objectClaimMap);
                    claim._resolveFromDataSource(resolvedValue);
                }
                else {
                    throw new Error(`Claim ${claim.id} is marked as source-backed but data is not a pointer`);
                }
            }
        }
        // Resolve aggregation claims
        else if (claim instanceof NumericClaim && claim.aggregation) {
            const computedValue = executeNumericAggregation(claim.aggregation, this.values);
            claim._setComputedValue(computedValue);
            this.values.set(claim.id, computedValue);
        }
    }
    /**
     * Resolve a pointer string to numeric data from an object claim
     * @param pointer - Pointer string in format:
     *   - JSON: "claimId#/json/pointer/path"
     *   - Structured text: "claimId#line:N", "claimId#char:START-END", "claimId#lines:START-END"
     *   - Combined: "claimId#/json/path#line:N"
     * @param objectClaimMap - Map of object claim IDs to ObjectClaim instances
     * @returns The resolved NumericData
     */
    resolvePointer(pointer, objectClaimMap, defaultUnit) {
        const { sourceClaimId: claimId, path: pointerPath } = parseClaimPointer(pointer);
        const objectClaim = objectClaimMap.get(claimId);
        if (!objectClaim) {
            throw new Error(`Object claim ${claimId} not found for pointer ${pointer}`);
        }
        // Use resolveObjectPointer to handle all pointer formats (JSON, StructuredText, combined)
        // Note: We no longer automatically parse vlayer response.body - use @parseJson() transformation in the pointer instead
        const resolvedValue = resolveObjectPointer(objectClaim.data, pointerPath);
        // Convert resolved value to NumericData
        return this.convertToNumericData(resolvedValue, pointer, defaultUnit);
    }
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
    convertToNumericData(value, pointer, defaultUnit) {
        // If already NumericData (object with value and unit), return it
        if (typeof value === 'object' && value !== null) {
            const obj = value;
            if (typeof obj.value === 'number' && typeof obj.unit === 'string') {
                return {
                    value: obj.value,
                    unit: obj.unit,
                    asset: typeof obj.asset === 'object' && obj.asset !== null ? obj.asset : undefined,
                };
            }
        }
        if (!defaultUnit) {
            throw new Error(`Pointer ${pointer} resolved to a plain value without a unit. ` +
                `Specify 'unit' on the source-backed numeric claim to provide a default.`);
        }
        // If it's a plain number, wrap it
        if (typeof value === 'number') {
            return {
                value,
                unit: defaultUnit,
            };
        }
        // If it's a string, parse it as a number
        if (typeof value === 'string') {
            const cleaned = value.trim().replace(/,/g, '');
            const parsed = parseFloat(cleaned);
            if (isNaN(parsed)) {
                throw new Error(`Cannot parse numeric value from string "${value}" at pointer ${pointer}`);
            }
            return {
                value: parsed,
                unit: defaultUnit,
            };
        }
        throw new Error(`Pointer ${pointer} does not resolve to a valid numeric value (got ${typeof value})`);
    }
    /**
     * Resolve a pointer string to a string value from an object claim
     * @param pointer - Pointer string in format "claimId#/json/pointer/path"
     * @param objectClaimMap - Map of object claim IDs to ObjectClaim instances
     * @returns The resolved string value
     */
    resolveStringPointer(pointer, objectClaimMap) {
        const { sourceClaimId: claimId, path: pointerPath } = parseClaimPointer(pointer);
        const objectClaim = objectClaimMap.get(claimId);
        if (!objectClaim) {
            throw new Error(`Object claim ${claimId} not found for pointer ${pointer}`);
        }
        // Use resolveObjectPointer to handle all pointer formats
        const resolvedValue = resolveObjectPointer(objectClaim.data, pointerPath);
        // Convert resolved value to string
        if (typeof resolvedValue === 'string') {
            return resolvedValue;
        }
        if (typeof resolvedValue === 'number' || typeof resolvedValue === 'boolean') {
            return String(resolvedValue);
        }
        throw new Error(`Pointer ${pointer} does not resolve to a string value (got ${typeof resolvedValue})`);
    }
    /**
     * Export all claims to data format
     * All claims are resolved incrementally as they are added.
     */
    toClaimData() {
        return this.getAllClaims().map(claim => claim.toData());
    }
    /**
     * Check if adding the given claim creates a cycle
     * Uses DFS to detect back edges
     */
    hasCycle(startId) {
        const visited = new Set();
        const recursionStack = new Set();
        const dfs = (id) => {
            visited.add(id);
            recursionStack.add(id);
            const claim = this.claims.get(id);
            if (claim?.isComposite && 'dependencies' in claim) {
                for (const depId of claim.dependencies) {
                    if (!visited.has(depId)) {
                        // Dependency might not exist yet, which is fine
                        if (this.claims.has(depId) && dfs(depId)) {
                            return true;
                        }
                    }
                    else if (recursionStack.has(depId)) {
                        return true;
                    }
                }
            }
            recursionStack.delete(id);
            return false;
        };
        return dfs(startId);
    }
}
//# sourceMappingURL=claim-dag.js.map