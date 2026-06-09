/**
 * Aggregation types for SAVE
 *
 * Aggregations define how composite claims derive their values
 * from sub-claims and other aggregations. Supports nested/composite
 * aggregation expressions.
 *
 * @example
 * // Simple: sum of two claims
 * { function: 'sum', operands: ['claimA', 'claimB'] }
 *
 * // Nested: claimA + (claimB - claimC)
 * {
 *   function: 'sum',
 *   operands: [
 *     'claimA',
 *     { function: 'subtract', operands: ['claimB', 'claimC'] }
 *   ]
 * }
 */
/** Type guard to check if an operand is a claim ID (string) */
export function isClaimReference(operand) {
    return typeof operand === 'string';
}
/** Type guard to check if an operand is a nested aggregation */
export function isNestedAggregation(operand) {
    return typeof operand === 'object' && operand !== null && 'function' in operand;
}
/** Type guard for sum aggregation */
export function isSumAggregation(agg) {
    return agg.function === 'sum';
}
/** Type guard for subtract aggregation */
export function isSubtractAggregation(agg) {
    return agg.function === 'subtract';
}
/**
 * Extract all unique claim IDs referenced in an aggregation (including nested ones)
 */
export function getReferencedClaimIds(aggregation) {
    const claimIds = new Set();
    const collect = (agg) => {
        for (const operand of agg.operands) {
            if (isClaimReference(operand)) {
                claimIds.add(operand);
            }
            else {
                collect(operand);
            }
        }
    };
    collect(aggregation);
    return Array.from(claimIds);
}
//# sourceMappingURL=aggregation.js.map