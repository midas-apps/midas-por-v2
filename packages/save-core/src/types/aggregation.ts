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
export function isClaimReference(operand: AggregationOperand): operand is ClaimId {
  return typeof operand === 'string';
}

/** Type guard to check if an operand is a nested aggregation */
export function isNestedAggregation(operand: AggregationOperand): operand is NumericAggregation {
  return typeof operand === 'object' && operand !== null && 'function' in operand;
}

/** Type guard for sum aggregation */
export function isSumAggregation(agg: Aggregation): agg is SumAggregation {
  return agg.function === 'sum';
}

/** Type guard for subtract aggregation */
export function isSubtractAggregation(agg: Aggregation): agg is SubtractAggregation {
  return agg.function === 'subtract';
}

/**
 * Extract all unique claim IDs referenced in an aggregation (including nested ones)
 */
export function getReferencedClaimIds(aggregation: Aggregation): ClaimId[] {
  const claimIds = new Set<ClaimId>();
  
  const collect = (agg: Aggregation): void => {
    for (const operand of agg.operands) {
      if (isClaimReference(operand)) {
        claimIds.add(operand);
      } else {
        collect(operand);
      }
    }
  };
  
  collect(aggregation);
  return Array.from(claimIds);
}
