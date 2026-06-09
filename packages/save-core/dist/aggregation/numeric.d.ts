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
import type { ClaimId, SumAggregation, SubtractAggregation, NumericAggregation, AggregationOperand } from '../types/index.js';
/** Maximum allowed depth for nested aggregations */
export declare const MAX_AGGREGATION_DEPTH = 16;
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
export declare function sum(...operands: AggregationOperand[]): SumAggregation;
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
export declare function subtract(...operands: AggregationOperand[]): SubtractAggregation;
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
export declare function executeNumericAggregation(aggregation: NumericAggregation, values: Map<ClaimId, number>): number;
//# sourceMappingURL=numeric.d.ts.map