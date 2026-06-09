/**
 * NumericClaim - Represents a quantitative assertion
 *
 * This module provides utilities for creating and working with numeric claims.
 * Claims can be:
 * - Inline: predefined structure (numeric data) with external proof
 * - Source-backed: pointer to data in an object claim that has a proof
 * - Aggregated: computed from other claims using aggregation functions
 */
import { getReferencedClaimIds } from '../types/aggregation.js';
import { isNumericData, isClaimPointer } from '../types/claim.js';
/**
 * Create a numeric claim content object that can be signed.
 *
 * Use this function to create standardized claim objects that
 * external parties can sign.
 *
 * @example
 * ```typescript
 * const claim = createNumericClaim({
 *   id: 'eth_balance',
 *   value: 600000,
 *   unit: 'USDC',
 *   description: 'Ethereum holdings'
 * });
 * // External party signs this claim
 * const proof = signClaim(claim, privateKey);
 * ```
 */
export function createNumericClaim(options) {
    return {
        id: options.id,
        claimType: 'inline',
        dataType: 'numeric',
        value: options.value,
        unit: options.unit,
        asset: options.asset,
        description: options.description,
    };
}
/**
 * NumericClaim manages numeric claims in the attestation builder.
 *
 * Can represent:
 * - Inline: predefined structure (numeric data) with proof
 * - Source-backed: pointer to object claim that has a proof
 * - Aggregated: computed from other claims using aggregation functions
 */
export class NumericClaim {
    _id;
    _description;
    _data;
    _proof;
    _aggregation;
    _unit; // Default unit for source-backed resolution
    _resolvedValue; // Store resolved value separately for source-backed claims
    constructor(id, data, description, proof, aggregation, unit) {
        this._id = id;
        this._data = data;
        this._description = description;
        this._proof = proof;
        this._aggregation = aggregation;
        this._unit = unit;
    }
    /**
     * Create an inline numeric claim from an externally signed claim.
     *
     * Inline claims have a predefined structure (numeric data) and contain both
     * the data and the proof for it.
     *
     * @example
     * ```typescript
     * // External party creates and signs a claim
     * const claimContent = createNumericClaim({
     *   id: 'eth_balance',
     *   value: 600000,
     *   unit: 'USDC'
     * });
     * const proof = signClaim(claimContent, custodianPrivateKey);
     *
     * // Protocol receives and wraps the signed claim
     * const claim = NumericClaim.inline({
     *   claim: claimContent,
     *   proof: proof
     * });
     * ```
     */
    static inline(options) {
        const { claim, proof } = options;
        const data = {
            value: claim.value,
            unit: claim.unit,
            asset: claim.asset,
        };
        return new NumericClaim(claim.id, data, claim.description, proof, undefined);
    }
    /**
     * Create a source-backed numeric claim (pointer to object claim).
     *
     * @example
     * ```typescript
     * const claim = NumericClaim.sourceBacked({
     *   id: 'cex_assets',
     *   dataPointer: 'cex_snapshot_001#/accounts/0/balance',
     *   description: 'CEX balance from snapshot'
     * });
     * ```
     */
    static sourceBacked(options) {
        return new NumericClaim(options.id, options.dataPointer, options.description, undefined, undefined, options.unit);
    }
    /**
     * Create an aggregated numeric claim.
     * Value will be computed when the claim is resolved in a DAG.
     *
     * @example
     * ```typescript
     * const claim = NumericClaim.aggregated({
     *   id: 'net_position',
     *   aggregation: {
     *     function: 'subtract',
     *     operands: ['assets', 'liabilities']
     *   }
     * });
     * ```
     */
    static aggregated(options) {
        if (!options.aggregation) {
            throw new Error('Aggregated claim must have an aggregation');
        }
        if (options.aggregation.operands.length === 0) {
            throw new Error('Aggregation must have at least one operand');
        }
        return new NumericClaim(options.id, undefined, options.description, undefined, options.aggregation);
    }
    /** Unique identifier for this claim */
    get id() {
        return this._id;
    }
    /** Human-readable description */
    get description() {
        return this._description;
    }
    /** Check if this is an inline claim (predefined structure with proof) */
    get isInline() {
        return this._proof !== undefined;
    }
    /** Check if this is a source-backed (pointer) claim */
    get isSourceBacked() {
        return isClaimPointer(this._data);
    }
    /** Check if this is an aggregated claim */
    get isAggregated() {
        return this._aggregation !== undefined;
    }
    /** Get the proof (only for inline claims) */
    get proof() {
        return this._proof;
    }
    /** Get the aggregation (only for aggregated claims) */
    get aggregation() {
        return this._aggregation;
    }
    /** Get the data (NumericData for inline, ClaimPointer for source-backed, undefined for aggregated) */
    get data() {
        return this._data;
    }
    /** Default unit for source-backed claims resolved to plain numbers */
    get unit() {
        return this._unit;
    }
    /** Get IDs of all claims this claim depends on (source-backed pointer or aggregation operands) */
    get dependencies() {
        // Source-backed claims depend on the referenced object claim
        if (this.isSourceBacked && isClaimPointer(this._data)) {
            const hashIndex = this._data.indexOf('#');
            if (hashIndex !== -1) {
                return [this._data.substring(0, hashIndex)];
            }
        }
        // Aggregation claims depend on their operands
        if (this._aggregation) {
            return getReferencedClaimIds(this._aggregation);
        }
        return [];
    }
    /**
     * Get the value (for inline data or after DAG resolution)
     * Returns undefined for unresolved aggregated claims or unresolved pointer claims
     */
    get value() {
        // For aggregated and source-backed claims, return the resolved value
        if (this.isAggregated || this.isSourceBacked) {
            return this._resolvedValue;
        }
        // For inline claims, get value from data
        if (isNumericData(this._data)) {
            return this._data.value;
        }
        return undefined;
    }
    /**
     * Check if the claim has a resolved value
     */
    get isResolved() {
        return this.value !== undefined;
    }
    /** Primitive claims are leaf nodes: inline or source-backed (not aggregated) */
    get isPrimitive() {
        return this.isInline || this.isSourceBacked;
    }
    /** Composite claims are aggregated claims */
    get isComposite() {
        return this.isAggregated;
    }
    /**
     * Set the computed value (used by DAG resolver)
     * For aggregated claims, stores the computed value in _resolvedValue
     * @internal
     */
    _setComputedValue(value) {
        if (this.isAggregated) {
            // For aggregated claims, store the resolved value separately
            this._resolvedValue = value;
        }
        else {
            throw new Error('Cannot set computed value on non-aggregated claim');
        }
    }
    /**
     * Resolve a source-backed claim with data from an object claim
     * @internal
     */
    _resolveFromDataSource(data) {
        if (!this.isSourceBacked) {
            throw new Error('Can only resolve source-backed claims');
        }
        // Store the resolved value separately, keep the pointer intact
        this._resolvedValue = data.value;
    }
    /**
     * Export claim to data format for attestation
     */
    toData() {
        if (this.isAggregated && this._aggregation) {
            return {
                id: this._id,
                claimType: 'aggregation',
                dataType: 'numeric',
                aggregation: this._aggregation,
                ...(this._resolvedValue !== undefined && { resolvedValue: this._resolvedValue }),
                ...(this._description !== undefined && { description: this._description }),
            };
        }
        if (this.isSourceBacked && isClaimPointer(this._data)) {
            return {
                id: this._id,
                claimType: 'source-backed',
                dataType: 'numeric',
                pointer: this._data,
                ...(this._resolvedValue !== undefined && { resolvedValue: this._resolvedValue }),
                ...(this._description !== undefined && { description: this._description }),
            };
        }
        // Inline claim
        if (!this._proof) {
            throw new Error(`Inline claim ${this._id} is missing proof`);
        }
        if (!isNumericData(this._data)) {
            throw new Error(`Inline claim ${this._id} is missing numeric data`);
        }
        return {
            id: this._id,
            claimType: 'inline',
            dataType: 'numeric',
            data: this._data,
            proof: this._proof,
            ...(this._description !== undefined && { description: this._description }),
        };
    }
}
//# sourceMappingURL=numeric.js.map