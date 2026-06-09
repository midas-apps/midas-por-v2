/**
 * Numeric aggregation functions
 *
 * Supports nested/composite aggregation expressions.
 * Maximum nesting depth is limited to 16 levels.
 *
 * @example
 * // Simple sum
 * sum('claimA', 'claimB')
 *
 * // Nested: claimA + (claimB - claimC)
 * sum('claimA', subtract('claimB', 'claimC'))
 *
 * // Complex: (claimA + claimB) - (claimC + claimD)
 * subtract(sum('claimA', 'claimB'), sum('claimC', 'claimD'))
 */
import { isClaimReference } from '../types/aggregation.js';
/** Maximum allowed depth for nested aggregations */
export const MAX_AGGREGATION_DEPTH = 16;
/**
 * Create a sum aggregation
 *
 * Computes: result = operand1 + operand2 + ...
 *
 * @param operands - Claim IDs or nested aggregations to sum
 * @returns SumAggregation configuration
 *
 * @example
 * // Sum of claims
 * sum('claim1', 'claim2', 'claim3')
 *
 * // Sum with nested subtraction
 * sum('totalAssets', subtract('grossLiabilities', 'adjustments'))
 */
export function sum(...operands) {
    if (operands.length === 0) {
        throw new Error('Sum aggregation requires at least one operand');
    }
    return {
        function: 'sum',
        operands,
    };
}
/**
 * Create a subtraction aggregation
 *
 * Computes: result = operand1 - operand2 - operand3 - ...
 * The first operand is the minuend, all others are subtrahends.
 *
 * @param operands - Claim IDs or nested aggregations (first is minuend)
 * @returns SubtractAggregation configuration
 *
 * @example
 * // Simple subtraction
 * subtract('assets', 'liabilities')
 *
 * // Nested: totalAssets - (liability1 + liability2)
 * subtract('totalAssets', sum('liability1', 'liability2'))
 */
export function subtract(...operands) {
    if (operands.length < 2) {
        throw new Error('Subtract aggregation requires at least two operands');
    }
    return {
        function: 'subtract',
        operands,
    };
}
/**
 * Execute a numeric aggregation function on resolved values
 *
 * Supports nested aggregations - will recursively evaluate nested expressions.
 * Maximum nesting depth is limited to 16 levels.
 *
 * @param aggregation - The aggregation configuration (can be nested)
 * @param values - Map of claim IDs to their resolved numeric values
 * @returns Computed result
 * @throws Error if maximum nesting depth is exceeded
 */
export function executeNumericAggregation(aggregation, values) {
    return executeWithDepth(aggregation, values, 0);
}
/**
 * Internal function that tracks recursion depth
 */
function executeWithDepth(aggregation, values, depth) {
    if (depth >= MAX_AGGREGATION_DEPTH) {
        throw new Error(`Maximum aggregation nesting depth (${MAX_AGGREGATION_DEPTH}) exceeded`);
    }
    // Resolve each operand (either claim value or nested aggregation)
    const resolvedValues = aggregation.operands.map(operand => resolveOperandWithDepth(operand, values, depth + 1));
    switch (aggregation.function) {
        case 'sum':
            return resolvedValues.reduce((acc, val) => acc + val, 0);
        case 'subtract': {
            const [first, ...rest] = resolvedValues;
            return rest.reduce((acc, val) => acc - val, first);
        }
        default:
            throw new Error(`Unknown aggregation function: ${aggregation.function}`);
    }
}
/**
 * Resolve an operand to its numeric value, tracking depth
 */
function resolveOperandWithDepth(operand, values, depth) {
    if (isClaimReference(operand)) {
        // It's a claim ID - look up the value
        const value = values.get(operand);
        if (value === undefined) {
            throw new Error(`Claim ${operand} has not been resolved`);
        }
        return value;
    }
    else {
        // It's a nested aggregation - recursively evaluate
        return executeWithDepth(operand, values, depth);
    }
}
//# sourceMappingURL=numeric.js.map