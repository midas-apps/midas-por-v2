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
import type { ClaimId } from './common.js';
/** Supported aggregation functions for numeric claims */
export type NumericAggregationFunction = 'sum' | 'subtract';
/**
 * An operand in an aggregation expression.
 * Can be either:
 * - A claim ID (string) referencing a claim's value
 * - A nested aggregation expression
 */
export type AggregationOperand = ClaimId | NumericAggregation;
/**
 * Sum aggregation
 *
 * Computes: value = operand1 + operand2 + ...
 * Each operand can be a claim ID or nested aggregation.
 */
export interface SumAggregation {
    function: 'sum';
    operands: AggregationOperand[];
}
/**
 * Subtraction aggregation
 *
 * Computes: value = operand1 - operand2 - operand3 - ...
 * The first operand is the minuend, rest are subtrahends.
 * Each operand can be a claim ID or nested aggregation.
 */
export interface SubtractAggregation {
    function: 'subtract';
    operands: AggregationOperand[];
}
/** Union of all numeric aggregation types */
export type NumericAggregation = SumAggregation | SubtractAggregation;
/**
 * Union of all aggregation types.
 * Currently numeric-only. To support other data types (e.g., string concat),
 * add a new aggregation interface and include it in this union.
 */
export type Aggregation = NumericAggregation;
/** Type guard to check if an operand is a claim ID (string) */
export declare function isClaimReference(operand: AggregationOperand): operand is ClaimId;
/** Type guard to check if an operand is a nested aggregation */
export declare function isNestedAggregation(operand: AggregationOperand): operand is NumericAggregation;
/** Type guard for sum aggregation */
export declare function isSumAggregation(agg: Aggregation): agg is SumAggregation;
/** Type guard for subtract aggregation */
export declare function isSubtractAggregation(agg: Aggregation): agg is SubtractAggregation;
/**
 * Extract all unique claim IDs referenced in an aggregation (including nested ones)
 */
export declare function getReferencedClaimIds(aggregation: Aggregation): ClaimId[];
//# sourceMappingURL=aggregation.d.ts.map